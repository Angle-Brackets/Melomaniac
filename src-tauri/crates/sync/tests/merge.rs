use melomaniac_storage::{PlaylistMeta, TrackEntry, TreeBlob};
use melomaniac_sync::{ConflictKind, diff_trees};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn tree(name: &str, tracks: Vec<TrackEntry>) -> TreeBlob {
    TreeBlob {
        v: 2,
        meta: PlaylistMeta {
            name: name.to_string(),
            description: None,
            artwork_hash: None,
            extra: Default::default(),
        },
        tracks,
        includes: vec![],
        extra: Default::default(),
    }
}

fn entry(hash: &str) -> TrackEntry {
    TrackEntry {
        hash: hash.to_string(),
        ab_start_ms: None,
        ab_end_ms: None,
        title: None,
        artist: None,
        album: None,
        duration_ms: None,
        mime_type: None,
        artwork_hash: None,
        extra: Default::default(),
    }
}

fn entry_ab(hash: &str, start: u64, end: u64) -> TrackEntry {
    TrackEntry {
        hash: hash.to_string(),
        ab_start_ms: Some(start),
        ab_end_ms: Some(end),
        title: None,
        artist: None,
        album: None,
        duration_ms: None,
        mime_type: None,
        artwork_hash: None,
        extra: Default::default(),
    }
}

// ── Test 1: Identity — base == ours == theirs ─────────────────────────────────

#[test]
fn identity_no_conflicts_merged_equals_base() {
    let t = vec![entry("a"), entry("b"), entry("c")];
    let base  = tree("Playlist", t.clone());
    let ours  = tree("Playlist", t.clone());
    let theirs = tree("Playlist", t.clone());

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "identity should produce no conflicts");
    let merged = merged.expect("identity should produce a merged tree");
    assert_eq!(
        merged.tracks.iter().map(|e| e.hash.as_str()).collect::<Vec<_>>(),
        vec!["a", "b", "c"]
    );
    assert_eq!(merged.meta.name, "Playlist");
}

// ── Test 2: Fast-forward ours (ours == base, theirs added tracks) ─────────────

#[test]
fn fast_forward_theirs_additions_no_conflict() {
    let base_tracks = vec![entry("a"), entry("b")];
    let base   = tree("P", base_tracks.clone());
    let ours   = tree("P", base_tracks.clone());   // ours unchanged
    let theirs = tree("P", vec![entry("a"), entry("b"), entry("c")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "fast-forward theirs should produce no conflicts");
    let merged = merged.expect("should have merged tree");
    let hashes: Vec<&str> = merged.tracks.iter().map(|e| e.hash.as_str()).collect();
    assert!(hashes.contains(&"a"));
    assert!(hashes.contains(&"b"));
    assert!(hashes.contains(&"c"));
}

// ── Test 3: Fast-forward ours (theirs == base, ours added tracks) ────────────

#[test]
fn fast_forward_ours_additions_no_conflict() {
    let base_tracks = vec![entry("a"), entry("b")];
    let base   = tree("P", base_tracks.clone());
    let ours   = tree("P", vec![entry("a"), entry("b"), entry("x")]);
    let theirs = tree("P", base_tracks.clone());   // theirs unchanged

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "fast-forward ours should produce no conflicts");
    let merged = merged.expect("should have merged tree");
    let hashes: Vec<&str> = merged.tracks.iter().map(|e| e.hash.as_str()).collect();
    assert!(hashes.contains(&"a"));
    assert!(hashes.contains(&"b"));
    assert!(hashes.contains(&"x"), "ours-only addition must be in merged output");
}

// ── Test 4: True merge additive — both sides added different tracks ───────────

#[test]
fn true_merge_additive_no_conflicts() {
    let base   = tree("P", vec![entry("a"), entry("b")]);
    let ours   = tree("P", vec![entry("a"), entry("b"), entry("x")]);
    let theirs = tree("P", vec![entry("a"), entry("b"), entry("y")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "additive merge should produce no conflicts");
    let merged = merged.expect("should have merged tree");
    let hashes: Vec<&str> = merged.tracks.iter().map(|e| e.hash.as_str()).collect();
    assert!(hashes.contains(&"a"), "base tracks preserved");
    assert!(hashes.contains(&"b"), "base tracks preserved");
    assert!(hashes.contains(&"x"), "ours addition included");
    assert!(hashes.contains(&"y"), "theirs addition included");
}

// ── Test 5: Track order conflict — both sides reordered differently ───────────

#[test]
fn track_order_conflict_when_both_reordered_differently() {
    let base   = tree("P", vec![entry("a"), entry("b"), entry("c")]);
    let ours   = tree("P", vec![entry("b"), entry("a"), entry("c")]);   // a↔b swap
    let theirs = tree("P", vec![entry("c"), entry("b"), entry("a")]);   // reversed

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(!conflicts.is_empty(), "should have a conflict");
    assert!(
        conflicts.iter().any(|c| matches!(c.kind, ConflictKind::TrackOrder)),
        "conflict should be TrackOrder"
    );
    assert!(merged.is_none(), "no merged tree when conflicts exist");
}

// ── Test 6: MetaName conflict — both sides renamed to different values ────────

#[test]
fn metadata_name_conflict_when_both_sides_rename() {
    let base   = tree("Original", vec![entry("a")]);
    let ours   = tree("Our Name",   vec![entry("a")]);
    let theirs = tree("Their Name", vec![entry("a")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(!conflicts.is_empty(), "should have a metadata conflict");
    assert!(
        conflicts.iter().any(|c| matches!(c.kind, ConflictKind::MetadataEdit)),
        "conflict should be MetadataEdit"
    );
    assert!(merged.is_none(), "no merged tree when conflicts exist");
}

// ── Test 7: Track deleted on one side, kept (present) on other ───────────────

#[test]
fn track_deleted_on_ours_kept_on_theirs_is_conflict() {
    let base   = tree("P", vec![entry("a"), entry("b"), entry("c")]);
    // ours deleted "b"
    let ours   = tree("P", vec![entry("a"), entry("c")]);
    // theirs kept "b"
    let theirs = tree("P", vec![entry("a"), entry("b"), entry("c")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(!conflicts.is_empty(), "deleting from one side should conflict");
    assert!(
        conflicts.iter().any(|c| matches!(c.kind, ConflictKind::TrackDeletedVsModified)),
        "conflict should be TrackDeletedVsModified"
    );
    assert!(merged.is_none(), "no merged tree when conflicts exist");
}

#[test]
fn track_deleted_on_theirs_kept_on_ours_is_conflict() {
    let base   = tree("P", vec![entry("a"), entry("b"), entry("c")]);
    // ours kept "b"
    let ours   = tree("P", vec![entry("a"), entry("b"), entry("c")]);
    // theirs deleted "b"
    let theirs = tree("P", vec![entry("a"), entry("c")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(!conflicts.is_empty(), "deleting from theirs should conflict");
    assert!(
        conflicts.iter().any(|c| matches!(c.kind, ConflictKind::TrackDeletedVsModified)),
        "conflict should be TrackDeletedVsModified"
    );
    assert!(merged.is_none(), "no merged tree when conflicts exist");
}

// ── Test 8: Ours == theirs (same change on both sides) → no conflict ──────────

#[test]
fn same_change_on_both_sides_no_conflict() {
    let base   = tree("P", vec![entry("a"), entry("b")]);
    let ours   = tree("P", vec![entry("a"), entry("b"), entry("z")]);
    let theirs = tree("P", vec![entry("a"), entry("b"), entry("z")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "identical changes on both sides → no conflict");
    let merged = merged.expect("should have merged tree");
    let hashes: Vec<&str> = merged.tracks.iter().map(|e| e.hash.as_str()).collect();
    assert!(hashes.contains(&"z"), "the shared change is included");
}

// ── Test 9: AB loop point conflict ───────────────────────────────────────────

#[test]
fn ab_loop_conflict_when_both_sides_changed_differently() {
    let base   = tree("P", vec![entry_ab("a", 1000, 5000)]);
    let ours   = tree("P", vec![entry_ab("a", 2000, 6000)]);
    let theirs = tree("P", vec![entry_ab("a", 3000, 7000)]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(!conflicts.is_empty(), "differing AB points should conflict");
    assert!(
        conflicts.iter().any(|c| matches!(c.kind, ConflictKind::AbLoopPoints)),
        "conflict should be AbLoopPoints"
    );
    assert!(merged.is_none(), "no merged tree when conflicts exist");
}

// ── Test 10: One side changed AB, other side did not → no conflict ────────────

#[test]
fn ab_loop_no_conflict_when_only_one_side_changed() {
    let base   = tree("P", vec![entry_ab("a", 1000, 5000)]);
    let ours   = tree("P", vec![entry_ab("a", 2000, 6000)]);  // ours changed
    let theirs = tree("P", vec![entry_ab("a", 1000, 5000)]);  // theirs same as base

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "only ours changed AB points → no conflict");
    assert!(merged.is_some(), "should produce a merged tree");
}

// ── Test 11: Metadata — only one side renamed → auto-merged ──────────────────

#[test]
fn metadata_name_auto_merged_when_only_ours_changed() {
    let base   = tree("Original", vec![entry("a")]);
    let ours   = tree("Renamed",  vec![entry("a")]);
    let theirs = tree("Original", vec![entry("a")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "only ours renamed → no conflict");
    let merged = merged.expect("should produce merged tree");
    assert_eq!(merged.meta.name, "Renamed", "ours name wins");
}

#[test]
fn metadata_name_auto_merged_when_only_theirs_changed() {
    let base   = tree("Original", vec![entry("a")]);
    let ours   = tree("Original", vec![entry("a")]);
    let theirs = tree("Peer Name", vec![entry("a")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "only theirs renamed → no conflict");
    let merged = merged.expect("should produce merged tree");
    assert_eq!(merged.meta.name, "Peer Name", "theirs name wins");
}

// ── Test 12: Both sides deleted the same track → no conflict ─────────────────

#[test]
fn both_sides_deleted_same_track_no_conflict() {
    let base   = tree("P", vec![entry("a"), entry("b"), entry("c")]);
    let ours   = tree("P", vec![entry("a"), entry("c")]);   // both deleted "b"
    let theirs = tree("P", vec![entry("a"), entry("c")]);

    let (conflicts, merged) = diff_trees(&base, &ours, &theirs);

    assert!(conflicts.is_empty(), "both deleting same track → no conflict");
    let merged = merged.expect("should produce merged tree");
    let hashes: Vec<&str> = merged.tracks.iter().map(|e| e.hash.as_str()).collect();
    assert!(!hashes.contains(&"b"), "deleted track absent from merge");
}
