use std::io::Cursor;
use std::path::Path;

use id3::TagLike;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;

use crate::{CasStore, Database, StorageError, TrackRecord};

// ── Public API ────────────────────────────────────────────────────────────────

/// Ingest a file from a known path on disk.
pub async fn ingest_file(
    path: &Path,
    cas: &CasStore,
    db: &Database,
) -> Result<TrackRecord, StorageError> {
    let bytes = tokio::fs::read(path).await?;
    let name_hint = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown");
    ingest_bytes(&bytes, name_hint, cas, db).await
}

/// Ingest raw audio bytes (e.g. from `include_bytes!` or a yt-dlp pipe).
/// Idempotent — if the hash already exists in the DB the existing record is
/// returned immediately without re-reading tags.
pub async fn ingest_bytes(
    bytes: &[u8],
    name_hint: &str,
    cas: &CasStore,
    db: &Database,
) -> Result<TrackRecord, StorageError> {
    // 1. Hash + write blob (no-op if already present)
    let hash = cas.write_blob(bytes).await?;

    // 2. Already indexed? Return fast — unless fields are missing (duration or artwork),
    //    in which case fall through to patch them.
    if let Some(existing) = db.get_track(&hash).await? {
        let needs_duration = existing.duration_ms == 0;
        let needs_artwork  = existing.artwork_hash.is_none();

        if !needs_duration && !needs_artwork {
            return Ok(existing);
        }

        let mime_type = detect_mime(bytes);
        let (tags, artwork_bytes) = extract_tags(bytes, &existing.title, &mime_type);

        let artwork_hash = if needs_artwork {
            if let Some(art) = artwork_bytes {
                let ah = cas.write_blob(&art).await.ok();
                if let Some(ref ah) = ah {
                    db.update_artwork_hash(&hash, ah).await.ok();
                }
                ah
            } else {
                None
            }
        } else {
            existing.artwork_hash.clone()
        };

        let duration_ms = if needs_duration {
            let d = tags.duration_ms.max(probe_duration_ms(bytes).unwrap_or(0));
            if d > 0 { db.update_duration(&hash, d).await.ok(); }
            d
        } else {
            existing.duration_ms
        };

        return Ok(TrackRecord { duration_ms, artwork_hash, ..existing });
    }

    // 3. Detect MIME type from magic bytes
    let mime_type = detect_mime(bytes);

    // 4. Extract tags + embedded artwork
    let (tags, artwork_bytes) = extract_tags(bytes, name_hint, &mime_type);

    // 5. Write artwork blob if present
    let artwork_hash = if let Some(art) = artwork_bytes {
        cas.write_blob(&art).await.ok()
    } else {
        None
    };

    // 6. Insert into DB
    let record = TrackRecord {
        hash,
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        artwork_hash,
        duration_ms: tags.duration_ms,
        favorited: false,
        mime_type: Some(mime_type),
        ingested_at: 0,
        source_url: None,
    };
    db.insert_track(&record).await?;

    Ok(record)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

struct Tags {
    title:       String,
    artist:      String,
    album:       Option<String>,
    duration_ms: i64,
}

fn detect_mime(bytes: &[u8]) -> String {
    if bytes.starts_with(b"fLaC") { return "audio/flac".to_string(); }
    if bytes.starts_with(b"OggS") { return "audio/ogg".to_string();  }
    if bytes.len() >= 12
        && &bytes[0..4] == b"RIFF"
        && &bytes[8..12] == b"WAVE"      { return "audio/wav".to_string();  }
    if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2
            && bytes[0] == 0xFF
            && bytes[1] & 0xE0 == 0xE0)  { return "audio/mpeg".to_string(); }
    "application/octet-stream".to_string()
}

/// Returns `(tags, artwork_bytes)`. Artwork is the first embedded picture, if any.
fn extract_tags(bytes: &[u8], name_hint: &str, mime_type: &str) -> (Tags, Option<Vec<u8>>) {
    if mime_type == "audio/mpeg" {
        if let Ok(tag) = id3::Tag::read_from2(Cursor::new(bytes)) {
            let title  = tag.title() .map(str::to_string)
                            .unwrap_or_else(|| name_hint.to_string());
            let artist = tag.artist().map(str::to_string)
                            .unwrap_or_else(|| "Unknown Artist".to_string());
            let album  = tag.album() .map(str::to_string);
            // TLEN frame: milliseconds per ID3 spec; often absent — fall back to symphonia probe.
            let duration_ms = tag.duration()
                .filter(|&d| d > 0)
                .map(|d| d as i64)
                .unwrap_or_else(|| probe_duration_ms(bytes).unwrap_or(0));

            // Prefer cover-front picture; fall back to any embedded picture.
            let artwork = tag.pictures()
                .find(|p| p.picture_type == id3::frame::PictureType::CoverFront)
                .or_else(|| tag.pictures().next())
                .map(|p| p.data.clone());

            return (Tags { title, artist, album, duration_ms }, artwork);
        }
    }

    // For non-MP3 or untagged files, still attempt duration probe.
    let duration_ms = probe_duration_ms(bytes).unwrap_or(0);
    (
        Tags {
            title:       name_hint.to_string(),
            artist:      "Unknown Artist".to_string(),
            album:       None,
            duration_ms,
        },
        None,
    )
}

/// Probe audio bytes via symphonia to get duration in milliseconds.
/// Returns `None` if the format is unsupported or duration is unavailable.
fn probe_duration_ms(bytes: &[u8]) -> Option<i64> {
    let cursor = Cursor::new(bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let probed = symphonia::default::get_probe()
        .format(&Hint::new(), mss, &Default::default(), &Default::default())
        .ok()?;

    let track = probed.format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)?;

    let n_frames    = track.codec_params.n_frames?;
    let sample_rate = track.codec_params.sample_rate?;

    Some((n_frames as f64 / sample_rate as f64 * 1000.0) as i64)
}
