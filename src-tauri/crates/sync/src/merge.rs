use crate::{ConflictChunk, ConflictKind};
use melomaniac_storage::TreeBlob;

/// Compare three tree versions and return conflicts plus an auto-merged tree if there are none.
pub fn diff_trees(
    base: &TreeBlob,
    ours: &TreeBlob,
    theirs: &TreeBlob,
) -> (Vec<ConflictChunk>, Option<TreeBlob>) {
    let mut conflicts = Vec::new();

    // ── Metadata conflict ─────────────────────────────────────────────────────
    if ours.meta.name != theirs.meta.name
        && ours.meta.name != base.meta.name
        && theirs.meta.name != base.meta.name
    {
        conflicts.push(ConflictChunk {
            id: uuid::Uuid::new_v4().to_string(),
            kind: ConflictKind::MetadataEdit,
            ours: serde_json::json!(ours.meta.name),
            theirs: serde_json::json!(theirs.meta.name),
            context: serde_json::json!(base.meta.name),
        });
    }

    // ── Track order conflict ──────────────────────────────────────────────────
    let base_hashes: Vec<&str> = base.tracks.iter().map(|t| t.hash.as_str()).collect();
    let our_hashes: Vec<&str> = ours.tracks.iter().map(|t| t.hash.as_str()).collect();
    let their_hashes: Vec<&str> = theirs.tracks.iter().map(|t| t.hash.as_str()).collect();

    let our_set: std::collections::HashSet<&str> = our_hashes.iter().copied().collect();
    let their_set: std::collections::HashSet<&str> = their_hashes.iter().copied().collect();

    if our_set == their_set
        && our_hashes != their_hashes
        && our_hashes != base_hashes
        && their_hashes != base_hashes
    {
        conflicts.push(ConflictChunk {
            id: uuid::Uuid::new_v4().to_string(),
            kind: ConflictKind::TrackOrder,
            ours: serde_json::json!(our_hashes),
            theirs: serde_json::json!(their_hashes),
            context: serde_json::json!(base_hashes),
        });
    }

    // ── Track deletion vs modification ────────────────────────────────────────
    for base_track in &base.tracks {
        let in_ours = ours.tracks.iter().any(|t| t.hash == base_track.hash);
        let in_theirs = theirs.tracks.iter().any(|t| t.hash == base_track.hash);

        if !in_ours && in_theirs {
            let their_version = theirs.tracks.iter().find(|t| t.hash == base_track.hash);
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::TrackDeletedVsModified,
                ours: serde_json::Value::Null,
                theirs: serde_json::to_value(their_version).unwrap_or(serde_json::Value::Null),
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        } else if in_ours && !in_theirs {
            let our_version = ours.tracks.iter().find(|t| t.hash == base_track.hash);
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::TrackDeletedVsModified,
                ours: serde_json::to_value(our_version).unwrap_or(serde_json::Value::Null),
                theirs: serde_json::Value::Null,
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        }
    }

    // ── A/B loop point conflicts ──────────────────────────────────────────────
    for our_track in &ours.tracks {
        let Some(their_track) = theirs.tracks.iter().find(|t| t.hash == our_track.hash) else {
            continue;
        };
        let base_track = base.tracks.iter().find(|t| t.hash == our_track.hash);

        let ab_differs = our_track.ab_start_ms != their_track.ab_start_ms
            || our_track.ab_end_ms != their_track.ab_end_ms;

        let both_changed = if let Some(bt) = base_track {
            (our_track.ab_start_ms != bt.ab_start_ms || our_track.ab_end_ms != bt.ab_end_ms)
                && (their_track.ab_start_ms != bt.ab_start_ms
                    || their_track.ab_end_ms != bt.ab_end_ms)
        } else {
            ab_differs
        };

        if ab_differs && both_changed {
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::AbLoopPoints,
                ours: serde_json::json!({
                    "hash": our_track.hash,
                    "ab_start_ms": our_track.ab_start_ms,
                    "ab_end_ms": our_track.ab_end_ms,
                }),
                theirs: serde_json::json!({
                    "hash": their_track.hash,
                    "ab_start_ms": their_track.ab_start_ms,
                    "ab_end_ms": their_track.ab_end_ms,
                }),
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        }
    }

    if !conflicts.is_empty() {
        return (conflicts, None);
    }

    // ── Auto-merge ────────────────────────────────────────────────────────────
    let base_set: std::collections::HashSet<&str> = base_hashes.iter().copied().collect();

    let mut merged_tracks: Vec<melomaniac_storage::TrackEntry> = ours
        .tracks
        .iter()
        .filter(|t| base_set.contains(t.hash.as_str()) || their_set.contains(t.hash.as_str()))
        .cloned()
        .collect();

    merged_tracks.retain(|t| {
        !base_set.contains(t.hash.as_str()) || their_set.contains(t.hash.as_str())
    });

    let their_additions: Vec<melomaniac_storage::TrackEntry> = {
        let merged_hashes: std::collections::HashSet<&str> =
            merged_tracks.iter().map(|t| t.hash.as_str()).collect();
        theirs
            .tracks
            .iter()
            .filter(|t| {
                !base_set.contains(t.hash.as_str()) && !merged_hashes.contains(t.hash.as_str())
            })
            .cloned()
            .collect()
    };
    merged_tracks.extend(their_additions);

    let merged_name = if ours.meta.name != base.meta.name {
        ours.meta.name.clone()
    } else {
        theirs.meta.name.clone()
    };

    let merged_desc = if ours.meta.description != base.meta.description {
        ours.meta.description.clone()
    } else {
        theirs.meta.description.clone()
    };

    let merged_artwork = if ours.meta.artwork_hash != base.meta.artwork_hash {
        ours.meta.artwork_hash.clone()
    } else {
        theirs.meta.artwork_hash.clone()
    };

    let merged_tree = TreeBlob {
        v: 2,
        meta: melomaniac_storage::PlaylistMeta {
            name: merged_name,
            description: merged_desc,
            artwork_hash: merged_artwork,
            extra: Default::default(),
        },
        tracks: merged_tracks,
        includes: ours.includes.clone(),
        extra: Default::default(),
    };

    (vec![], Some(merged_tree))
}
