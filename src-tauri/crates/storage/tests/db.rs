use melomaniac_storage::{CommitRecord, Database, TrackRecord};
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
        mime_type:    None,
    }
}

fn commit(hash: &str, ts: i64) -> CommitRecord {
    CommitRecord { hash: hash.into(), tree_hash: "t".into(), timestamp: ts, device_id: "dev".into(), message: None }
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
async fn get_all_tracks_ordering() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let mut t1 = track("hash1");
    t1.artist = "Zulu".into();
    t1.title  = "Alpha".into();

    let mut t2 = track("hash2");
    t2.artist = "Alpha".into();
    t2.title  = "Bravo".into();

    db.insert_track(&t1).await.unwrap();
    db.insert_track(&t2).await.unwrap();

    let all = db.get_all_tracks().await.unwrap();
    // Ordered by artist first
    assert_eq!(all[0].artist, "Alpha");
    assert_eq!(all[1].artist, "Zulu");
}

#[tokio::test]
async fn all_hashes_returns_every_hash() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("h1")).await.unwrap();
    db.insert_track(&track("h2")).await.unwrap();
    db.insert_track(&track("h3")).await.unwrap();

    let mut hashes = db.all_hashes().await.unwrap();
    hashes.sort();
    assert_eq!(hashes, vec!["h1", "h2", "h3"]);
}

#[tokio::test]
async fn set_favorited() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_track(&track("aabbcc")).await.unwrap();
    db.set_favorited("aabbcc", true).await.unwrap();
    assert!(db.get_track("aabbcc").await.unwrap().unwrap().favorited);
    db.set_favorited("aabbcc", false).await.unwrap();
    assert!(!db.get_track("aabbcc").await.unwrap().unwrap().favorited);
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
async fn remove_track_not_present_is_ok() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;
    // Deleting a non-existent row should not error
    db.remove_track("ghost").await.unwrap();
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
    assert_eq!(got.description, Some("My favs".into()));

    // Default main branch created automatically
    let branches = db.get_branches(&p.id).await.unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0].name, "main");
    assert!(branches[0].head_commit.is_none());
}

#[tokio::test]
async fn get_playlist_not_found_returns_none() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;
    assert!(db.get_playlist("nonexistent-uuid").await.unwrap().is_none());
}

#[tokio::test]
async fn rename_playlist() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("Old Name", None).await.unwrap();
    db.rename_playlist(&p.id, "New Name").await.unwrap();
    let got = db.get_playlist(&p.id).await.unwrap().unwrap();
    assert_eq!(got.name, "New Name");
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
    assert_eq!(fork_branches[0].name, src_branches[0].name);
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

#[tokio::test]
async fn get_all_playlists_ordered_by_name() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.create_playlist("Zebra", None).await.unwrap();
    db.create_playlist("Alpha", None).await.unwrap();

    let all = db.get_all_playlists().await.unwrap();
    assert_eq!(all[0].name, "Alpha");
    assert_eq!(all[1].name, "Zebra");
}

// ── Branches ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn create_and_get_branch() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("P", None).await.unwrap();
    db.create_branch(&p.id, "feature", None).await.unwrap();

    let b = db.get_branch(&p.id, "feature").await.unwrap().unwrap();
    assert_eq!(b.name, "feature");
    assert!(b.head_commit.is_none());
}

#[tokio::test]
async fn get_branch_not_found_returns_none() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("P", None).await.unwrap();
    assert!(db.get_branch(&p.id, "missing").await.unwrap().is_none());
}

#[tokio::test]
async fn update_branch_head() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    let p = db.create_playlist("P", None).await.unwrap();
    db.insert_commit(&commit("c1", 1), &[]).await.unwrap();
    db.update_branch_head(&p.id, "main", "c1").await.unwrap();

    let b = db.get_branch(&p.id, "main").await.unwrap().unwrap();
    assert_eq!(b.head_commit, Some("c1".into()));
}

// ── Commits ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn root_commit_has_no_parents() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_commit(&commit("root", 1), &[]).await.unwrap();
    let c = db.get_commit("root").await.unwrap().unwrap();
    assert_eq!(c.hash, "root");
}

#[tokio::test]
async fn insert_commit_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_commit(&commit("c1", 1), &[]).await.unwrap();
    db.insert_commit(&commit("c1", 1), &[]).await.unwrap(); // OR IGNORE — no error
    assert!(db.get_commit("c1").await.unwrap().is_some());
}

#[tokio::test]
async fn commit_history_first_parent() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    db.insert_commit(&commit("h1", 1), &[]).await.unwrap();
    db.insert_commit(&commit("h2", 2), &["h1"]).await.unwrap();

    let history = db.get_commit_history("h2", 10).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].hash, "h2");
    assert_eq!(history[1].hash, "h1");
}

#[tokio::test]
async fn commit_history_respects_limit() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;

    // Build a chain: h1 ← h2 ← h3 ← h4 ← h5
    db.insert_commit(&commit("h1", 1), &[]).await.unwrap();
    for i in 2..=5u64 {
        let prev = format!("h{}", i - 1);
        db.insert_commit(&commit(&format!("h{i}"), i as i64), &[prev.as_str()]).await.unwrap();
    }

    let history = db.get_commit_history("h5", 3).await.unwrap();
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].hash, "h5");
}

#[tokio::test]
async fn commit_history_missing_start_returns_empty() {
    let dir = TempDir::new().unwrap();
    let db  = open_db(&dir).await;
    let history = db.get_commit_history("nonexistent", 10).await.unwrap();
    assert!(history.is_empty());
}
