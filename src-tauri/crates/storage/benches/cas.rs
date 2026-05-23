use criterion::{black_box, criterion_group, criterion_main, Criterion};
use melomaniac_storage::CasStore;
use tempfile::TempDir;

/// Populate a CasStore with `n` blobs of varying sizes and return both the
/// store and the TempDir (which must stay alive for the benchmark duration).
fn make_cas(n: usize) -> (CasStore, TempDir) {
    let dir = tempfile::tempdir().expect("tempdir");
    let cas = CasStore::new(dir.path().to_path_buf());

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        for i in 0..n {
            // Vary blob size: small (32 B) through larger (4 KB) to exercise
            // realistic path distributions inside the two-level directory layout.
            let size = 32 + (i * 37 % 4096);
            let data: Vec<u8> = (0..size).map(|b| (b ^ i) as u8).collect();
            cas.write_blob(&data).await.expect("write_blob");
        }
    });

    (cas, dir)
}

fn bench_list_all_hashes(c: &mut Criterion) {
    let (cas, _dir) = make_cas(100);

    c.bench_function("CasStore::list_all_hashes (100 blobs)", |b| {
        b.iter(|| {
            let hashes = cas.list_all_hashes();
            black_box(hashes);
        });
    });
}

criterion_group!(benches, bench_list_all_hashes);
criterion_main!(benches);
