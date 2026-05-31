use criterion::{black_box, criterion_group, criterion_main, Criterion};
use melomaniac_storage::{IncludeEntry, PlaylistMeta, TrackEntry, TreeBlob};

/// Build a realistic TreeBlob with `n` tracks so we have something non-trivial
/// to serialise / deserialise.
fn make_tree(n: usize) -> TreeBlob {
    let tracks: Vec<TrackEntry> = (0..n)
        .map(|i| TrackEntry {
            hash: format!("{:064x}", i),
            ab_start_ms: if i % 3 == 0 { Some(0) } else { None },
            ab_end_ms: if i % 3 == 0 { Some(180_000) } else { None },
            title: Some(format!("Track {i}")),
            artist: Some(format!("Artist {}", i % 10)),
            album: Some(format!("Album {}", i % 5)),
            duration_ms: Some(200_000 + i as i64 * 1000),
            mime_type: Some("audio/mpeg".to_string()),
            artwork_hash: Some(format!("{:064x}", i % 20)),
            extra: Default::default(),
        })
        .collect();

    let includes: Vec<IncludeEntry> = (0..3)
        .map(|i| IncludeEntry {
            playlist_id: format!("playlist-{i}"),
            branch: "main".to_string(),
            pinned_commit: None,
            extra: Default::default(),
        })
        .collect();

    TreeBlob {
        v: 2,
        meta: PlaylistMeta {
            name: "Benchmark Playlist".to_string(),
            description: Some("A playlist used only for benchmarking".to_string()),
            artwork_hash: Some(format!("{:064x}", 42u64)),
            extra: Default::default(),
        },
        tracks,
        includes,
        extra: Default::default(),
    }
}

fn bench_tree_to_json(c: &mut Criterion) {
    let tree = make_tree(50);

    c.bench_function("TreeBlob::to_json (50 tracks)", |b| {
        b.iter(|| {
            let json = tree.to_json().expect("to_json");
            black_box(json);
        });
    });
}

fn bench_tree_from_bytes(c: &mut Criterion) {
    let tree = make_tree(50);
    let json_bytes = tree.to_json().expect("to_json").into_bytes();

    c.bench_function("TreeBlob::from_bytes (50 tracks)", |b| {
        b.iter(|| {
            let parsed = TreeBlob::from_bytes(black_box(&json_bytes)).expect("from_bytes");
            black_box(parsed);
        });
    });
}

criterion_group!(benches, bench_tree_to_json, bench_tree_from_bytes);
criterion_main!(benches);
