//! Fuzzy matching of imported Spotify tracks against the local CAS library,
//! plus the persistence layer around it. See `context/SPOTIFY.md` and the
//! design doc referenced from `context/PLAN.md`'s "Spotify Integration"
//! backlog for the full confidence-tier rationale.

use tauri::State;

use melomaniac_storage::{ExternalTrackRecord, NewExternalTrack, TrackRecord};

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
///
/// `rejected` excludes hashes the user has previously flagged as a wrong
/// match for this exact external track — checked even for the ISRC
/// short-circuit, since a bad ISRC/fingerprint match is just as rejectable
/// as a fuzzy one.
fn best_match(input: &MatchInput, library: &[TrackRecord], rejected: &[String]) -> Option<(String, f32)> {
    if let Some(isrc) = input.isrc {
        if let Some(hit) = library
            .iter()
            .find(|t| t.isrc.as_deref() == Some(isrc) && !rejected.iter().any(|r| r == &t.hash))
        {
            return Some((hit.hash.clone(), 1.0));
        }
    }

    let norm_title = normalize(input.title);
    let norm_artist = normalize(input.artist);

    let mut best: Option<(String, f32)> = None;
    for track in library {
        if rejected.iter().any(|r| r == &track.hash) {
            continue;
        }
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

/// Provider-prefixed key into `track_rejections` for an external track.
/// Prefixing (rather than relying on `external_tracks`' own primary key)
/// keeps the rejections table reusable across providers.
fn external_id_for(provider: &str, provider_track_id: &str) -> String {
    format!("{provider}:{provider_track_id}")
}

fn to_new_external_track(provider: &str, source: &str, position: i64, t: SpotifyTrack) -> Option<NewExternalTrack> {
    let provider_track_id = t.id?;
    Some(NewExternalTrack {
        provider: provider.to_string(),
        provider_track_id,
        title: t.title,
        artist: t.artist,
        album: Some(t.album),
        duration_ms: t.duration_ms as i64,
        isrc: t.isrc,
        artwork_url: t.artwork_url,
        source: source.to_string(),
        position,
    })
}

/// Import (upsert) a batch of external tracks, then run the fuzzy matcher over
/// only the rows that don't already have a link (preserving any existing
/// manual link/unlink decision). Returns the full, up-to-date imported-track
/// list — global across all sources, matching the flat-library UI model.
#[tauri::command]
pub async fn import_external_playlist_tracks(
    provider: String,
    source: String,
    tracks: Vec<SpotifyTrack>,
    storage: State<'_, StorageState>,
) -> Result<Vec<ExternalTrackRecord>, String> {
    let new_tracks: Vec<NewExternalTrack> = tracks
        .into_iter()
        .enumerate()
        .filter_map(|(i, t)| to_new_external_track(&provider, &source, i as i64, t))
        .collect();

    storage
        .db
        .upsert_external_tracks(&new_tracks)
        .await
        .map_err(|e| e.to_string())?;

    let library = storage.db.get_all_tracks().await.map_err(|e| e.to_string())?;
    let imported = storage.db.get_external_tracks().await.map_err(|e| e.to_string())?;

    let unmatched: Vec<&ExternalTrackRecord> =
        imported.iter().filter(|t| t.matched_hash.is_none()).collect();

    for t in unmatched {
        let input = MatchInput {
            title: &t.title,
            artist: &t.artist,
            duration_ms: t.duration_ms,
            isrc: t.isrc.as_deref(),
        };
        let rejected = storage
            .db
            .get_rejected_hashes(&external_id_for(&t.provider, &t.provider_track_id))
            .await
            .map_err(|e| e.to_string())?;
        if let Some((hash, score)) = best_match(&input, &library, &rejected) {
            storage
                .db
                .set_external_track_match(&t.provider, &t.provider_track_id, &t.source, Some(&hash), Some(score))
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    storage.db.get_external_tracks().await.map_err(|e| e.to_string())
}

/// Returns imported external tracks as currently persisted — called on
/// Library mount so external rows survive restarts without re-importing.
#[tauri::command]
pub async fn get_imported_external_tracks(
    storage: State<'_, StorageState>,
) -> Result<Vec<ExternalTrackRecord>, String> {
    storage.db.get_external_tracks().await.map_err(|e| e.to_string())
}

/// Manually link an external track to a local track hash — used both by the
/// user picking a match the matcher missed, and (via `confidence: None`) to
/// distinguish user-confirmed links from algorithmic ones.
#[tauri::command]
pub async fn link_external_track(
    provider: String,
    provider_track_id: String,
    source: String,
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .set_external_track_match(&provider, &provider_track_id, &source, Some(&hash), None)
        .await
        .map_err(|e| e.to_string())
}

/// Undo a link (auto or manual), demoting the track back to an external row.
#[tauri::command]
pub async fn unlink_external_track(
    provider: String,
    provider_track_id: String,
    source: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .set_external_track_match(&provider, &provider_track_id, &source, None, None)
        .await
        .map_err(|e| e.to_string())
}

/// Like `unlink_external_track`, but also permanently blacklists `hash` for
/// this external track so the matcher can never re-suggest it — for when the
/// link is actively wrong, not just undesired. Applies regardless of the
/// confidence the matcher originally reported; even a 99%-confidence match
/// can be completely wrong. Does not touch the local library track itself,
/// since it may be a legitimately correct match for something else.
#[tauri::command]
pub async fn reject_external_track_match(
    provider: String,
    provider_track_id: String,
    source: String,
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .add_track_rejection(&external_id_for(&provider, &provider_track_id), &hash)
        .await
        .map_err(|e| e.to_string())?;
    storage
        .db
        .set_external_track_match(&provider, &provider_track_id, &source, None, None)
        .await
        .map_err(|e| e.to_string())
}

/// Reverses `reject_external_track_match` — re-links `hash` and lifts the
/// blacklist entry, for the "Undo" action on the reject toast.
#[tauri::command]
pub async fn undo_reject_external_track_match(
    provider: String,
    provider_track_id: String,
    source: String,
    hash: String,
    storage: State<'_, StorageState>,
) -> Result<(), String> {
    storage
        .db
        .remove_track_rejection(&external_id_for(&provider, &provider_track_id), &hash)
        .await
        .map_err(|e| e.to_string())?;
    storage
        .db
        .set_external_track_match(&provider, &provider_track_id, &source, Some(&hash), None)
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
        let (hash, score) = best_match(&input, &library, &[]).expect("should match");
        assert_eq!(hash, "h1");
        assert!(score >= MATCH_THRESHOLD);
    }

    #[test]
    fn fuzzy_match_with_junk_suffix() {
        let library = vec![track("h1", "Song Title (Remastered 2011)", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_100, isrc: None };
        let (hash, score) = best_match(&input, &library, &[]).expect("should match");
        assert_eq!(hash, "h1");
        assert!(score >= MATCH_THRESHOLD);
    }

    #[test]
    fn duration_gate_rejects_close_title_wrong_length() {
        let library = vec![track("h1", "Song Title", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 400_000, isrc: None };
        assert!(best_match(&input, &library, &[]).is_none());
    }

    #[test]
    fn no_match_for_unrelated_track() {
        let library = vec![track("h1", "Completely Different", "Other Band", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: None };
        assert!(best_match(&input, &library, &[]).is_none());
    }

    #[test]
    fn isrc_short_circuit() {
        // Title/artist deliberately mismatched — only the ISRC equality should win this.
        let library = vec![track("h1", "Totally Wrong Title", "Wrong Artist", 999_000, Some("US1234567890"))];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: Some("US1234567890") };
        let (hash, score) = best_match(&input, &library, &[]).expect("should match via ISRC");
        assert_eq!(hash, "h1");
        assert_eq!(score, 1.0);
    }

    #[test]
    fn rejected_hash_is_excluded_from_fuzzy_match() {
        let library = vec![track("h1", "Song Title", "Artist Name", 200_000, None)];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: None };
        // Would match at score 1.0 absent the rejection.
        assert!(best_match(&input, &library, &["h1".to_string()]).is_none());
    }

    #[test]
    fn rejected_hash_is_excluded_even_via_isrc_short_circuit() {
        // Even a "perfect" ISRC match must stay rejectable.
        let library = vec![track("h1", "Song Title", "Artist Name", 200_000, Some("US1234567890"))];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: Some("US1234567890") };
        assert!(best_match(&input, &library, &["h1".to_string()]).is_none());
    }

    #[test]
    fn rejection_of_one_hash_does_not_block_a_different_candidate() {
        let library = vec![
            track("h1", "Song Title", "Artist Name", 200_000, None),
            track("h2", "Song Title", "Artist Name", 200_050, None),
        ];
        let input = MatchInput { title: "Song Title", artist: "Artist Name", duration_ms: 200_000, isrc: None };
        let (hash, _) = best_match(&input, &library, &["h1".to_string()]).expect("h2 should still match");
        assert_eq!(hash, "h2");
    }
}
