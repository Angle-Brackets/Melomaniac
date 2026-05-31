use melomaniac_storage::CasStore;
use tempfile::TempDir;

fn store(dir: &TempDir) -> CasStore {
    CasStore::new(dir.path().join("objects"))
}

#[tokio::test]
async fn write_and_read_roundtrip() {
    let dir = TempDir::new().unwrap();
    let cas = store(&dir);

    let data = b"hello melomaniac";
    let hash = cas.write_blob(data).await.unwrap();

    assert_eq!(hash.len(), 64);
    assert!(cas.exists(&hash));
    assert_eq!(cas.read_blob(&hash).await.unwrap(), data);
}

#[tokio::test]
async fn write_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let cas = store(&dir);

    let data = b"deduplicated";
    let h1 = cas.write_blob(data).await.unwrap();
    let h2 = cas.write_blob(data).await.unwrap();
    assert_eq!(h1, h2);
}

#[tokio::test]
async fn hash_is_content_derived() {
    let h1 = CasStore::hash(b"aaa");
    let h2 = CasStore::hash(b"bbb");
    assert_ne!(h1, h2);
    assert_eq!(h1, CasStore::hash(b"aaa"));
}

#[tokio::test]
async fn read_missing_blob_errors() {
    let dir = TempDir::new().unwrap();
    let cas = store(&dir);
    let fake = "a".repeat(64);
    assert!(cas.read_blob(&fake).await.is_err());
}

#[tokio::test]
async fn blob_path_layout() {
    let dir = TempDir::new().unwrap();
    let cas = store(&dir);
    let hash = "ab".to_string() + &"c".repeat(62);
    let path = cas.blob_path(&hash);
    assert!(path.to_string_lossy().contains("ab"));
}
