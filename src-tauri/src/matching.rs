//! Fuzzy matching of imported Spotify tracks against the local CAS library,
//! plus the persistence layer around it. See `context/SPOTIFY.md` and the
//! design doc referenced from `context/PLAN.md`'s "Spotify Integration"
//! backlog for the full confidence-tier rationale.

use tauri::State;

use melomaniac_storage::{NewSpotifyTrack, SpotifyTrackRecord, TrackRecord};

use crate::spotify::SpotifyTrack;
use crate::storage::StorageState;

/// Matches at or above this score auto-link silently; everything else is
/// treated identically to "no match" (shown as an external row).
const MATCH_THRESHOLD: f32 = 0.90;
/// Candidates whose duration differs from the input by more than this are
/// never considered, regardless of title/artist similarity.
const DURATION_GATE_MS: i64 = 8_000;

const TITLE_WEIGHT: f32 = 0.55;
const ARTIST_WEIGHT: f32 = 0.30;
const DURATION_WEIGHT: f32 = 0.15;

struct MatchInput<'a> {
    title: &'a str,
    artist: &'a str,
    duration_ms: i64,
    isrc: Option<&'a str>,
}

/// Lowercase, strip bracketed suffixes (`(Remastered 2011)`, `[Live]`), and
/// collapse punctuation to spaces so `"Song Title (feat. X)"` and
/// `"song title feat x"` compare as near-identical.
fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            _ if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn duration_score(a_ms: i64, b_ms: i64) -> f32 {
    let diff = (a_ms - b_ms).unsigned_abs() as f32;
    (1.0 - diff / DURATION_GATE_MS as f32).max(0.0)
}

/// Finds the best-scoring local track for `input`, if any candidate clears
/// `MATCH_THRESHOLD`. ISRC equality (when both sides have one) short-circuits
/// straight to a perfect-confidence match; today local ISRC is always NULL
/// so this path is a no-op hook for a future fingerprinting pass.
fn best_match(input: &MatchInput, library: &[TrackRecord]) -> Option<(String, f32)> {
    if let Some(isrc) = input.isrc {
        if let Some(hit) = library.iter().find(|t| t.isrc.as_deref() == Some(isrc)) {
            return Some((hit.hash.clone(), 1.0));
        }
    }

    let norm_title = normalize(input.title);
    let norm_artist = normalize(input.artist);

    let mut best: Option<(String, f32)> = None;
    for track in library {
        if (track.duration_ms - input.duration_ms).unsigned_abs() as i64 > DURATION_GATE_MS {
            continue;
        }

        let title_score = strsim::jaro_winkler(&norm_title, &normalize(&track.title)) as f32;
        let artist_score = strsim::jaro_winkler(&norm_artist, &normalize(&track.artist)) as f32;
        let dur_score = duration_score(input.duration_ms, track.duration_ms);

        let score = title_score * TITLE_WEIGHT + artist_score * ARTIST_WEIGHT + dur_score * DURATION_WEIGHT;

        if score >= MATCH_THRESHOLD && best.as_ref().map(|(_, s)| score > *s).unwrap_or(true) {
            best = Some((track.hash.clone(), score));
        }
    }
    best
}

fn to_new_spotify_track(source: &str, t: SpotifyTrack) -> Option<NewSpotifyTrack> {
    let spotify_id = t.id?;
    Some(NewSpotifyTrack {
        spotify_id,
        title: t.title,
        artist: t.artist,
        album: Some(t.album),
        duration_ms: t.duration_ms as i64,
        isrc: t.isrc,
        source: source.to_string(),
    })
}

/// Import (upsert) a batch of Spotify tracks, then run the fuzzy matcher over
/// only the rows that don't already have a link (preserving any existing
/// manual link/unlink decision). Returns the full, up-to-date imported-track
/// list — global across all sources, matching the flat-library UI model.
#[tauri::command]
pub async fn spotify_import_playlist_tracks(
    source: String,
    tracks: Vec<SpotifyTrack>,
    storage: State<'_, StorageState>,
) -> Result<Vec<SpotifyTrackRecord>, String> {
    let new_tracks: Vec<NewSpotifyTrack> = tracks
        .into_iter()
        .filter_map(|t| to_new_spotify_track(&source, t))
        .collect();

    storage
        .db
        .upsert_spotify_tracks(&new_tracks)
        .await
        .map_err(|e| e.to_string())?;

    let library = storage.db.get_all_tracks().await.map_err(|e| e.to_string())?;
    let imported = storage.db.get_spotify_tracks().await.map_err(|e| e.to_string())?;

    let unmatched: Vec<&SpotifyTrackRecord> =
        imported.iter().filter(|t| t.matched_hash.is_none()).collect();

    for t in unmatched {
        let input = MatchInput {
            title: &t.title,
            artist: &t.artist,
            duration_ms: t.duration_ms,
            isrc: t.isrc.as_deref(),
        };
        if let Some((hash, score)) = best_match(&input, &library) {
            storage
                .db
                .set_spotify_track_match(&t.spotify_id, Some(&hash), Some(score))
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    storage.db.get_spotify_tracks().await.map_err(|e| e.to_string())
}

/// Returns imported Spotify tracks as currently persisted — called on
/// Library mount so external rows survive restarts without re-importing.
#[tauri::command]
pub async fn spotify_get_imported_tracks(
    storage: State<'_, StorageState>,
) -> Result<Vec<SpotifyTrackRecord>, String> {
    storage.db.get_spotify_tracks().await.map_err(|e| e.to_string())
}

/// Manually link a Spotify track to a local track hash — used both by the
/// user picking a match the matcher missed, and (via `confidence: None`) to
/// distinguish user-confirmed links from algorithmic ones.
#[tauri::command]
pub async fn spotify_link_track(
    spotify_id: String,
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .set_spotify_track_match(&spotify_id, Some(&hash), None)
        .await
        .map_err(|e| e.to_string())
}

/// Undo a link (auto or manual), demoting the track back to an external row.
#[tauri::command]
pub async fn spotify_unlink_track(
    spotify_id: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .set_spotify_track_match(&spotify_id, None, None)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(hash: &str, title: &str, artist: &str, duration_ms: i64, isrc: Option<&str>) -> TrackRecord {
        TrackRecord {
            hash: hash.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: None,
            artwork_hash: None,
            duration_ms,
            favorited: false,
            mime_type: None,
            ingested_at: 0,
            source_url: None,
            isrc: isrc.map(|s| s.to_string()),
        }
    }

    #[test]
    fn exact_match() {
        let library = vec![track("h1", "Song Title", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: None };
        let (hash, score) = best_match(&input, &library).expect("should match");
        assert_eq!(hash, "h1");
        assert!(score >= MATCH_THRESHOLD);
    }

    #[test]
    fn fuzzy_match_with_junk_suffix() {
        let library = vec![track("h1", "Song Title (Remastered 2011)", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_100, isrc: None };
        let (hash, score) = best_match(&input, &library).expect("should match");
        assert_eq!(hash, "h1");
        assert!(score >= MATCH_THRESHOLD);
    }

    #[test]
    fn duration_gate_rejects_close_title_wrong_length() {
        let library = vec![track("h1", "Song Title", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 400_000, isrc: None };
        assert!(best_match(&input, &library).is_none());
    }

    #[test]
    fn no_match_for_unrelated_track() {
        let library = vec![track("h1", "Completely Different", "Other Band", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: None };
        assert!(best_match(&input, &library).is_none());
    }

    #[test]
    fn isrc_short_circuit() {
        // Title/artist deliberately mismatched — only the ISRC equality should win this.
        let library = vec![track("h1", "Totally Wrong Title", "Wrong Artist", 999_000, Some("US1234567890"))];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: Some("US1234567890") };
        let (hash, score) = best_match(&input, &library).expect("should match via ISRC");
        assert_eq!(hash, "h1");
        assert_eq!(score, 1.0);
    }
}
