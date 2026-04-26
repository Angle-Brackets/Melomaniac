use melomaniac_storage::{Database, TrackRecord};
use tempfile::TempDir;

async fn open_db(dir: &TempDir) -> Database {
    let db = Database::open(dir.path().join("db.sqlite")).await.unwrap();
    db.migrate().await.unwrap();
    db
}

fn track(hash: &str) -> TrackRecord {
    TrackRecord {
        hash:         hash.to_string(),
        title:        "Test Track".to_string(),
        artist:       "Test Artist".to_string(),
        album:        None,
        artwork_hash: None,
        duration_ms:  180_000,
        favorited:    false,
    }
}

// ── Tracks ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn insert_and_get_track() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("aabbcc")).await.unwrap();
    let t = db.get_track("aabbcc").await.unwrap().unwrap();
    assert_eq!(t.title, "Test Track");
}

#[tokio::test]
async fn insert_track_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("aabbcc")).await.unwrap();
    db.insert_track(&track("aabbcc")).await.unwrap(); // OR IGNORE — no error
    let all = db.get_all_tracks().await.unwrap();
    assert_eq!(all.len(), 1);
}

#[tokio::test]
async fn set_favorited() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("aabbcc")).await.unwrap();
    db.set_favorited("aabbcc", true).await.unwrap();
    assert!(db.get_track("aabbcc").await.unwrap().unwrap().favorited);
}

#[tokio::test]
async fn remove_track() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("aabbcc")).await.unwrap();
    db.remove_track("aabbcc").await.unwrap();
    assert!(db.get_track("aabbcc").await.unwrap().is_none());
}

#[tokio::test]
async fn track_exists() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    assert!(!db.track_exists("aabbcc").await.unwrap());
    db.insert_track(&track("aabbcc")).await.unwrap();
    assert!(db.track_exists("aabbcc").await.unwrap());
}

// ── Playlists ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn create_and_get_playlist() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("Favourites", Some("My favs")).await.unwrap();
    let got = db.get_playlist(&p.id).await.unwrap().unwrap();
    assert_eq!(got.name, "Favourites");

    // Default main branch created automatically
    let branches = db.get_branches(&p.id).await.unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].head_commit.is_none());
}

#[tokio::test]
async fn fork_playlist_copies_branches() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let src  = db.create_playlist("Source", None).await.unwrap();
    let fork = db.fork_playlist(&src.id, "Fork").await.unwrap();

    assert_eq!(fork.forked_from, Some(src.id.clone()));
    let fork_branches = db.get_branches(&fork.id).await.unwrap();
    let src_branches  = db.get_branches(&src.id).await.unwrap();
    assert_eq!(fork_branches.len(), src_branches.len());
}

#[tokio::test]
async fn delete_playlist_cascades() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("Delete me", None).await.unwrap();
    db.delete_playlist(&p.id).await.unwrap();

    assert!(db.get_playlist(&p.id).await.unwrap().is_none());
    assert!(db.get_branches(&p.id).await.unwrap().is_empty());
}

// ── Commits ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn commit_history_first_parent() {
    use melomaniac_storage::CommitRecord;

    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let c1 = CommitRecord { hash: "h1".into(), tree_hash: "t1".into(), timestamp: 1, device_id: "d".into(), message: None };
    let c2 = CommitRecord { hash: "h2".into(), tree_hash: "t2".into(), timestamp: 2, device_id: "d".into(), message: None };

    db.insert_commit(&c1, &[]).await.unwrap();
    db.insert_commit(&c2, &["h1"]).await.unwrap();

    let history = db.get_commit_history("h2", 10).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].hash, "h2");
    assert_eq!(history[1].hash, "h1");
}
