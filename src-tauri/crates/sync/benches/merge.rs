use criterion::{black_box, criterion_group, criterion_main, Criterion};
use melomaniac_storage::{PlaylistMeta, TrackEntry, TreeBlob};
use melomaniac_sync::diff_trees;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn make_track(hash: &str) -> TrackEntry {
    TrackEntry {
        hash: hash.to_string(),
        title: Some(format!("Track {hash}")),
        artist: Some("Test Artist".to_string()),
        album: Some("Test Album".to_string()),
        duration_ms: Some(210_000),
        mime_type: Some("audio/flac".to_string()),
        artwork_hash: None,
        ab_start_ms: None,
        ab_end_ms: None,
        extra: Default::default(),
    }
}

/// Build a `TreeBlob` from a list of hash strings.
fn make_tree(name: &str, hashes: &[&str]) -> TreeBlob {
    TreeBlob {
        v: 2,
        meta: PlaylistMeta {
            name: name.to_string(),
            description: Some("Benchmark playlist".to_string()),
            artwork_hash: None,
            extra: Default::default(),
        },
        tracks: hashes.iter().map(|h| make_track(h)).collect(),
        includes: vec![],
        extra: Default::default(),
    }
}

/// 40 stable hashes that act as a shared track pool across scenarios.
fn base_hashes() -> Vec<String> {
    (0..40).map(|i| format!("aabbcc{i:04x}aabbcc{i:04x}aabbcc{i:04x}aabbcc{i:04x}")).collect()
}

// ── Scenario builders ─────────────────────────────────────────────────────────

/// fast_forward: ours == base, theirs appended 15 new tracks.
/// Expected: no conflicts, auto-merged tree returned.
fn build_fast_forward() -> (TreeBlob, TreeBlob, TreeBlob) {
    let pool = base_hashes();
    let base_hs: Vec<&str> = pool.iter().map(String::as_str).collect();

    let base = make_tree("Chill Mix", &base_hs);
    let ours = base.clone();

    let mut their_hs = base_hs.clone();
    let extra: Vec<String> = (0..15)
        .map(|i| format!("ee1100{i:04x}ee1100{i:04x}ee1100{i:04x}ee1100{i:04x}"))
        .collect();
    let extra_refs: Vec<&str> = extra.iter().map(String::as_str).collect();
    their_hs.extend_from_slice(&extra_refs);
    let theirs = make_tree("Chill Mix", &their_hs);

    (base, ours, theirs)
}

/// true_merge_no_conflict: both sides added different tracks to a common base.
/// Expected: no conflicts, auto-merged tree with all additions.
fn build_true_merge_no_conflict() -> (TreeBlob, TreeBlob, TreeBlob) {
    let pool = base_hashes();
    let base_hs: Vec<&str> = pool.iter().map(String::as_str).collect();
    let base = make_tree("Road Trip", &base_hs);

    // ours adds 12 unique tracks
    let our_extra: Vec<String> = (0..12)
        .map(|i| format!("aa0011{i:04x}aa0011{i:04x}aa0011{i:04x}aa0011{i:04x}"))
        .collect();
    let mut our_hs = base_hs.clone();
    let our_extra_refs: Vec<&str> = our_extra.iter().map(String::as_str).collect();
    our_hs.extend_from_slice(&our_extra_refs);
    let ours = make_tree("Road Trip", &our_hs);

    // theirs adds 10 different unique tracks
    let their_extra: Vec<String> = (0..10)
        .map(|i| format!("bb2233{i:04x}bb2233{i:04x}bb2233{i:04x}bb2233{i:04x}"))
        .collect();
    let mut their_hs = base_hs.clone();
    let their_extra_refs: Vec<&str> = their_extra.iter().map(String::as_str).collect();
    their_hs.extend_from_slice(&their_extra_refs);
    let theirs = make_tree("Road Trip", &their_hs);

    (base, ours, theirs)
}

/// true_merge_with_conflicts: both sides reordered the same 40 tracks differently.
/// Expected: TrackOrder conflict, no merged tree.
fn build_true_merge_with_conflicts() -> (TreeBlob, TreeBlob, TreeBlob) {
    let pool = base_hashes();
    let base_hs: Vec<&str> = pool.iter().map(String::as_str).collect();
    let base = make_tree("Workout", &base_hs);

    // ours: reverse the second half of the list
    let mut our_hs = base_hs.clone();
    let mid = our_hs.len() / 2;
    our_hs[mid..].reverse();
    let ours = make_tree("Workout", &our_hs);

    // theirs: rotate the first half of the list by 5
    let mut their_hs = base_hs.clone();
    their_hs[..mid].rotate_left(5);
    let theirs = make_tree("Workout", &their_hs);

    (base, ours, theirs)
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

fn bench_fast_forward(c: &mut Criterion) {
    let (base, ours, theirs) = build_fast_forward();
    c.bench_function("diff_trees/fast_forward", |b| {
        b.iter(|| diff_trees(black_box(&base), black_box(&ours), black_box(&theirs)))
    });
}

fn bench_true_merge_no_conflict(c: &mut Criterion) {
    let (base, ours, theirs) = build_true_merge_no_conflict();
    c.bench_function("diff_trees/true_merge_no_conflict", |b| {
        b.iter(|| diff_trees(black_box(&base), black_box(&ours), black_box(&theirs)))
    });
}

fn bench_true_merge_with_conflicts(c: &mut Criterion) {
    let (base, ours, theirs) = build_true_merge_with_conflicts();
    c.bench_function("diff_trees/true_merge_with_conflicts", |b| {
        b.iter(|| diff_trees(black_box(&base), black_box(&ours), black_box(&theirs)))
    });
}

criterion_group!(
    benches,
    bench_fast_forward,
    bench_true_merge_no_conflict,
    bench_true_merge_with_conflicts,
);
criterion_main!(benches);
