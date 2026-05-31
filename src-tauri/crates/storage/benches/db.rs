use criterion::{black_box, criterion_group, criterion_main, Criterion};
use melomaniac_storage::{CommitRecord, Database};
use std::path::PathBuf;
use tokio::runtime::Runtime;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn make_commit(hash: &str, tree_hash: &str) -> CommitRecord {
    CommitRecord {
        hash:      hash.to_string(),
        tree_hash: tree_hash.to_string(),
        timestamp: 0,
        device_id: "bench-device".to_string(),
        message:   None,
    }
}

/// Open an in-memory SQLite database and run migrations.
async fn mem_db() -> Database {
    let db = Database::open(PathBuf::from(":memory:"))
        .await
        .expect("open");
    db.migrate().await.expect("migrate");
    db
}

/// Build a linear commit chain of length `n`, returning (head_hash, commits)
/// where commits[0] is the oldest (root) and commits[n-1] is the HEAD.
///
/// commit hashes are stable deterministic strings so we can insert them
/// into the DB without collision.
fn linear_chain(n: usize) -> (String, Vec<CommitRecord>) {
    let commits: Vec<CommitRecord> = (0..n)
        .map(|i| make_commit(&format!("commit-{i:04}"), &format!("tree-{i:04}")))
        .collect();
    let head = commits.last().unwrap().hash.clone();
    (head, commits)
}

/// Insert a linear chain into `db`.  commits[0] is the root (no parent),
/// each subsequent commit points at its predecessor.
async fn seed_linear_chain(db: &Database, commits: &[CommitRecord]) {
    for (i, commit) in commits.iter().enumerate() {
        let parents: Vec<&str> = if i == 0 {
            vec![]
        } else {
            vec![commits[i - 1].hash.as_str()]
        };
        db.insert_commit(commit, &parents)
            .await
            .expect("insert_commit");
    }
}

// ── find_common_ancestor ──────────────────────────────────────────────────────

/// Set up a scenario where two branches diverge from a common ancestor
/// halfway through a 50-commit chain, so `find_common_ancestor` must walk
/// ~25 commits on each side before it finds the merge-base.
fn bench_find_common_ancestor(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let db = rt.block_on(mem_db());

    // Build shared root (commits 0..25) then two diverging tips (25..50 each).
    let (_, shared) = linear_chain(25);
    rt.block_on(seed_linear_chain(&db, &shared));

    // Branch A: 25 commits on top of the shared tip
    let shared_tip = shared.last().unwrap().hash.clone();
    let branch_a: Vec<CommitRecord> = (0..25)
        .map(|i| make_commit(&format!("branch-a-{i:04}"), &format!("tree-a-{i:04}")))
        .collect();
    rt.block_on(async {
        for (i, commit) in branch_a.iter().enumerate() {
            let parent = if i == 0 {
                shared_tip.as_str()
            } else {
                branch_a[i - 1].hash.as_str()
            };
            db.insert_commit(commit, &[parent])
                .await
                .expect("insert_commit branch_a");
        }
    });

    // Branch B: 25 commits on top of the same shared tip
    let branch_b: Vec<CommitRecord> = (0..25)
        .map(|i| make_commit(&format!("branch-b-{i:04}"), &format!("tree-b-{i:04}")))
        .collect();
    rt.block_on(async {
        for (i, commit) in branch_b.iter().enumerate() {
            let parent = if i == 0 {
                shared_tip.as_str()
            } else {
                branch_b[i - 1].hash.as_str()
            };
            db.insert_commit(commit, &[parent])
                .await
                .expect("insert_commit branch_b");
        }
    });

    let tip_a = branch_a.last().unwrap().hash.clone();
    let tip_b = branch_b.last().unwrap().hash.clone();

    c.bench_function("Database::find_common_ancestor (50-commit chain, diverge at 25)", |b| {
        b.iter(|| {
            rt.block_on(async {
                let ancestor = db
                    .find_common_ancestor(black_box(&tip_a), black_box(&tip_b))
                    .await
                    .expect("find_common_ancestor");
                black_box(ancestor)
            })
        });
    });
}

// ── import_commit_chain ───────────────────────────────────────────────────────

fn bench_import_commit_chain(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    // Build a 20-commit chain in memory; we'll import it repeatedly.
    // Each iteration uses a fresh DB so we always measure an un-cached insert.
    let (_, commits) = linear_chain(20);
    // import_commit_chain expects HEAD-first ordering (reverse of insertion order)
    let chain: Vec<CommitRecord> = commits.into_iter().rev().collect();

    c.bench_function("Database::import_commit_chain (20 commits)", |b| {
        b.iter(|| {
            rt.block_on(async {
                let db = mem_db().await;
                db.import_commit_chain(black_box(&chain))
                    .await
                    .expect("import_commit_chain");
            })
        });
    });
}

// ── criterion wiring ──────────────────────────────────────────────────────────

criterion_group!(benches, bench_find_common_ancestor, bench_import_commit_chain);
criterion_main!(benches);
