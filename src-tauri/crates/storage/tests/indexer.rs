use melomaniac_storage::{CasStore, Database, Indexer, TrackRecord};
use tempfile::TempDir;

async fn setup(dir: &TempDir) -> (CasStore, Database) {
    let cas = CasStore::new(dir.path().join("objects"));
    let db  = Database::open(dir.path().join("db.sqlite")).await.unwrap();
    db.migrate().await.unwrap();
    (cas, db)
}

fn track(hash: &str) -> TrackRecord {
    TrackRecord {
        hash:         hash.to_string(),
        title:        "T".to_string(),
        artist:       "A".to_string(),
        album:        None,
        artwork_hash: None,
        duration_ms:  1000,
        favorited:    false,
    }
}

#[tokio::test]
async fn clean_state_no_op() {
    let dir = TempDir::new().unwrap();
    let (cas, db) = setup(&dir).await;

    let hash = cas.write_blob(b"audio").await.unwrap();
    db.insert_track(&track(&hash)).await.unwrap();

    let report = Indexer::new(&cas, &db).reconcile().await.unwrap();
    assert_eq!(report.stale_removed, 0);
    assert_eq!(report.orphan_blobs, 0);
}

#[tokio::test]
async fn stale_db_row_removed() {
    let dir = TempDir::new().unwrap();
    let (cas, db) = setup(&dir).await;

    // DB row with no corresponding blob
    db.insert_track(&track("a".repeat(64).as_str())).await.unwrap();

    let report = Indexer::new(&cas, &db).reconcile().await.unwrap();
    assert_eq!(report.stale_removed, 1);
    assert!(db.get_all_tracks().await.unwrap().is_empty());
}

#[tokio::test]
async fn orphan_blob_left_alone() {
    let dir = TempDir::new().unwrap();
    let (cas, db) = setup(&dir).await;

    // Blob with no DB row
    cas.write_blob(b"orphan data").await.unwrap();

    let report = Indexer::new(&cas, &db).reconcile().await.unwrap();
    assert_eq!(report.orphan_blobs, 1);
    assert_eq!(report.stale_removed, 0);
}

#[tokio::test]
async fn empty_objects_dir_is_fine() {
    let dir = TempDir::new().unwrap();
    let (cas, db) = setup(&dir).await;
    // objects dir never created — should not panic
    let report = Indexer::new(&cas, &db).reconcile().await.unwrap();
    assert_eq!(report.stale_removed, 0);
    assert_eq!(report.orphan_blobs, 0);
}

#[tokio::test]
async fn mixed_stale_and_orphan() {
    let dir = TempDir::new().unwrap();
    let (cas, db) = setup(&dir).await;

    // Blob with no DB row → orphan
    cas.write_blob(b"orphan").await.unwrap();

    // DB row with no blob → stale
    db.insert_track(&track("a".repeat(64).as_str())).await.unwrap();

    // Blob + matching DB row → clean
    let clean_hash = cas.write_blob(b"clean audio").await.unwrap();
    db.insert_track(&track(&clean_hash)).await.unwrap();

    let report = Indexer::new(&cas, &db).reconcile().await.unwrap();
    assert_eq!(report.stale_removed, 1);
    assert_eq!(report.orphan_blobs, 1);

    // The clean track survives
    let remaining = db.get_all_tracks().await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].hash, clean_hash);
}
