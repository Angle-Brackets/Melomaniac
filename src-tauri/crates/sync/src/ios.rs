use crate::identity::{TrustList, unix_now};
use crate::merge::diff_trees;
use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PendingMerge, PlaylistManifest, QrPayload, SyncBridge,
    SyncError, SyncReport, TrackSyncRecord,
    http_server::{ServerState, build_router},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use melomaniac_storage::{CasStore, CommitRecord, Database, TrackRecord, TreeBlob};
use rand::RngCore;
use rand::rngs::OsRng;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ── Swift FFI ─────────────────────────────────────────────────────────────────

unsafe extern "C" {
    fn melo_sync_start_discovery(
        on_discovered: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
        on_lost: extern "C" fn(*const std::ffi::c_char),
    );
    fn melo_sync_stop_discovery();
    fn melo_sync_register_service(pk: *const std::ffi::c_char, name: *const std::ffi::c_char, port: u16, addr_hint: *const std::ffi::c_char);
    fn melo_sync_unregister_service();
    fn melo_get_device_name(buf: *mut std::ffi::c_char, len: usize);
}

/// Called from Swift so that NWBrowser/NWListener state messages appear in the
/// same `eprintln!` stream as other Rust logs (Swift's own stderr goes to
/// Xcode's device console, not the `tauri ios dev` terminal).
#[unsafe(no_mangle)]
pub extern "C" fn melo_sync_log(msg: *const std::ffi::c_char) {
    let s = unsafe { std::ffi::CStr::from_ptr(msg).to_str().unwrap_or("?") };
    eprintln!("[MeloSync] {s}");
}

// ── Process-global peer registry ──────────────────────────────────────────────
//
// `extern "C" fn` pointers cannot capture state, so peer list and trust list
// are shared via process-globals that `IosSyncBridge::new` populates once.

static PEER_LIST: std::sync::OnceLock<Arc<RwLock<Vec<PeerInfo>>>> = std::sync::OnceLock::new();
static TRUST_LIST: std::sync::OnceLock<Arc<RwLock<TrustList>>> = std::sync::OnceLock::new();

extern "C" fn on_peer_discovered(
    pk_ptr: *const std::ffi::c_char,
    addr_ptr: *const std::ffi::c_char,
) {
    // SAFETY: Swift guarantees these are valid null-terminated UTF-8 strings
    // for the duration of the callback.
    let (pk, addr_str) = unsafe {
        let pk = std::ffi::CStr::from_ptr(pk_ptr)
            .to_str()
            .unwrap_or("")
            .to_string();
        let addr = std::ffi::CStr::from_ptr(addr_ptr)
            .to_str()
            .unwrap_or("")
            .to_string();
        (pk, addr)
    };

    if pk.is_empty() || addr_str.is_empty() {
        return;
    }

    eprintln!("[sync] on_peer_discovered: pk={}… addr={}", &pk[..8.min(pk.len())], addr_str);

    // Only add trusted peers.
    let Some(trust) = TRUST_LIST.get() else { return };
    let Ok(tl) = trust.read() else { return };
    if !tl.is_known(&pk) {
        eprintln!("[sync] on_peer_discovered: peer not in trust list — skipping");
        return;
    }
    drop(tl);

    let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() else {
        eprintln!("[sync] on_peer_discovered: cannot parse addr '{}' — skipping", addr_str);
        return;
    };

    // Display name: look up from trust list, fall back to truncated pk.
    let display_name = {
        let Ok(tl) = trust.read() else { return };
        tl.devices()
            .into_iter()
            .find(|d| d.public_key_b64 == pk)
            .map(|d| d.display_name)
            .unwrap_or_else(|| pk[..8.min(pk.len())].to_string())
    };

    let Some(peers) = PEER_LIST.get() else { return };
    let Ok(mut list) = peers.write() else { return };
    // Update in place or append.
    if let Some(existing) = list.iter_mut().find(|p| p.public_key_b64 == pk) {
        existing.addr = addr;
    } else {
        list.push(PeerInfo {
            public_key_b64: pk,
            display_name,
            addr,
            latency_ms: None,
        });
    }
}

extern "C" fn on_peer_lost(pk_ptr: *const std::ffi::c_char) {
    // SAFETY: Swift guarantees this is a valid null-terminated UTF-8 string
    // for the duration of the callback.
    let pk = unsafe {
        std::ffi::CStr::from_ptr(pk_ptr)
            .to_str()
            .unwrap_or("")
            .to_string()
    };
    if pk.is_empty() {
        return;
    }
    let Some(peers) = PEER_LIST.get() else { return };
    let Ok(mut list) = peers.write() else { return };
    list.retain(|p| p.public_key_b64 != pk);
}

// ── Network helpers ───────────────────────────────────────────────────────────

fn local_ip() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, UdpSocket};
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Some(ip @ IpAddr::V4(v4)) = socket.local_addr().ok().map(|a| a.ip()) {
                if v4 != Ipv4Addr::LOCALHOST {
                    return Some(ip);
                }
            }
        }
    }
    // Fallback: enumerate network interfaces (iOS is Unix).
    unsafe {
        let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut ifap) != 0 {
            return None;
        }
        let mut result = None;
        let mut ifa = ifap;
        while !ifa.is_null() {
            let addr_ptr = (*ifa).ifa_addr;
            if !addr_ptr.is_null()
                && (*addr_ptr).sa_family as libc::c_int == libc::AF_INET
            {
                use std::net::Ipv4Addr;
                let sin = &*(addr_ptr as *const libc::sockaddr_in);
                let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                if !ip.is_loopback() && !ip.is_link_local() {
                    result = Some(std::net::IpAddr::V4(ip));
                    break;
                }
            }
            ifa = (*ifa).ifa_next;
        }
        libc::freeifaddrs(ifap);
        result
    }
}

// ── HTTP client ───────────────────────────────────────────────────────────────

// Unreachable peers (asleep, off the network, firewalled) would otherwise
// hang on TCP connect for minutes with no client-side bound. Fail fast instead.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_default()
}

struct SyncClient {
    identity: Arc<NodeIdentity>,
    http: reqwest::Client,
    base_url: String,
}

impl SyncClient {
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn auth_header(&self) -> String {
        let ts = unix_now();
        let sig = self.identity.sign(ts.to_string().as_bytes());
        let pk = self.identity.public_key_b64();
        let sig_b64 = B64.encode(&sig);
        format!("Melomaniac {pk} {sig_b64}")
    }

    async fn get_manifest(&self) -> Result<Vec<PlaylistManifest>, SyncError> {
        let resp = self
            .http
            .get(self.url(super::routes::MANIFEST))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        resp.json::<Vec<PlaylistManifest>>()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }

    async fn get_blob(&self, hash: &str) -> Result<Vec<u8>, SyncError> {
        let resp = self
            .http
            .get(self.url(&super::routes::blob(hash)))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(SyncError::BlobTransferFailed(format!(
                "blob not found: {hash}"
            )));
        }

        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }

    async fn get_commits(
        &self,
        playlist_id: &str,
        branch: &str,
    ) -> Result<Vec<CommitRecord>, SyncError> {
        let resp = self
            .http
            .get(self.url(&super::routes::commits(playlist_id, branch)))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        resp.json::<Vec<CommitRecord>>()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }

    async fn get_tracks(&self, hashes: &[String]) -> Result<Vec<TrackSyncRecord>, SyncError> {
        let resp = self
            .http
            .post(self.url(super::routes::TRACKS))
            .header("Authorization", self.auth_header())
            .json(hashes)
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        resp.json::<Vec<TrackSyncRecord>>()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }
}

// ── Per-branch sync helper ────────────────────────────────────────────────────

async fn sync_one_branch_async(
    client: &SyncClient,
    identity: Arc<NodeIdentity>,
    db: Arc<Database>,
    cas: Arc<CasStore>,
    peer_entry: &PlaylistManifest,
    branch_name: &str,
    peer_display_name: &str,
    pending_merges: Arc<std::sync::Mutex<HashMap<String, PendingMerge>>>,
    progress_tx: Option<std::sync::mpsc::SyncSender<super::SyncProgress>>,
) -> Result<SyncReport, SyncError> {

    let playlist_id = peer_entry.id.clone();
    let local_branch_name = branch_name;

    let local_branches = db.get_branches(&playlist_id).await?;
    let local_head = local_branches.iter()
        .find(|b| b.name == branch_name)
        .and_then(|b| b.head_commit.clone());

    if branch_name == "main" && local_head.as_deref() == Some(&peer_entry.head_commit) {
        return Ok(SyncReport { blobs_fetched: 0, bytes_fetched: 0, conflicts: vec![] });
    }

    let peer_commits = client.get_commits(&playlist_id, branch_name).await?;

    let local_hashes: std::collections::HashSet<String> =
        cas.list_all_hashes().into_iter().collect();
    let mut needed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut blobs_fetched: usize = 0;
    let mut bytes_fetched: u64 = 0;

    for commit in &peer_commits {
        if local_hashes.contains(&commit.tree_hash) {
            if let Ok(bytes) = cas.read_blob(&commit.tree_hash).await {
                if let Ok(tree) = TreeBlob::from_bytes(&bytes) {
                    for track in &tree.tracks {
                        if !local_hashes.contains(&track.hash) {
                            needed.insert(track.hash.clone());
                        }
                        if let Some(ref art) = track.artwork_hash {
                            if !local_hashes.contains(art) {
                                needed.insert(art.clone());
                            }
                        }
                    }
                    if let Some(ref art) = tree.meta.artwork_hash {
                        if !local_hashes.contains(art) {
                            needed.insert(art.clone());
                        }
                    }
                }
            }
        } else {
            let bytes = client.get_blob(&commit.tree_hash).await?;
            bytes_fetched += bytes.len() as u64;
            if let Ok(tree) = TreeBlob::from_bytes(&bytes) {
                for track in &tree.tracks {
                    if !local_hashes.contains(&track.hash) {
                        needed.insert(track.hash.clone());
                    }
                    if let Some(ref art) = track.artwork_hash {
                        if !local_hashes.contains(art) {
                            needed.insert(art.clone());
                        }
                    }
                }
                if let Some(ref art) = tree.meta.artwork_hash {
                    if !local_hashes.contains(art) {
                        needed.insert(art.clone());
                    }
                }
            }
            cas.write_blob(&bytes).await?;
            blobs_fetched += 1;
        }
    }

    let total_needed = needed.len();
    let mut done_needed: usize = 0;
    for hash in &needed {
        let bytes = client.get_blob(hash).await?;
        bytes_fetched += bytes.len() as u64;
        cas.write_blob(&bytes).await?;
        blobs_fetched += 1;
        done_needed += 1;
        if let Some(ref tx) = progress_tx {
            tx.try_send(super::SyncProgress {
                playlist_id: playlist_id.clone(),
                done: done_needed,
                total: total_needed.max(1),
            }).ok();
        }
    }

    if let Some(head_commit) = peer_commits.first() {
        if let Ok(tree_bytes) = cas.read_blob(&head_commit.tree_hash).await {
            if let Ok(tree) = TreeBlob::from_bytes(&tree_bytes) {
                let all_hashes: Vec<String> =
                    tree.tracks.iter().map(|e| e.hash.clone()).collect();

                for entry in &tree.tracks {
                    if entry.title.is_some() {
                        let record = TrackRecord {
                            hash:         entry.hash.clone(),
                            title:        entry.title.clone().unwrap_or_default(),
                            artist:       entry.artist.clone().unwrap_or_default(),
                            album:        entry.album.clone(),
                            artwork_hash: entry.artwork_hash.clone(),
                            duration_ms:  entry.duration_ms.unwrap_or(0),
                            favorited:    false,
                            mime_type:    entry.mime_type.clone(),
                            ingested_at:  0,
                            source_url:   None,
                        };
                        if let Err(e) = db.upsert_track_from_sync(&record).await {
                            eprintln!("[sync] upsert_track_from_sync: {e}");
                        }
                    }
                }

                if !all_hashes.is_empty() {
                    let fetched = client.get_tracks(&all_hashes).await.unwrap_or_default();
                    let fetched_hashes: std::collections::HashSet<String> =
                        fetched.iter().map(|r| r.hash.clone()).collect();

                    let local_hashes_now: std::collections::HashSet<String> =
                        cas.list_all_hashes().into_iter().collect();
                    for r in &fetched {
                        if let Some(ref art) = r.artwork_hash {
                            if !local_hashes_now.contains(art) {
                                match client.get_blob(art).await {
                                    Ok(bytes) => {
                                        bytes_fetched += bytes.len() as u64;
                                        if cas.write_blob(&bytes).await.is_ok() {
                                            blobs_fetched += 1;
                                        }
                                    }
                                    Err(e) => eprintln!("[sync] artwork blob {art}: {e}"),
                                }
                            }
                        }
                    }

                    for r in fetched {
                        let record = TrackRecord {
                            hash:         r.hash,
                            title:        r.title,
                            artist:       r.artist,
                            album:        r.album,
                            artwork_hash: r.artwork_hash,
                            duration_ms:  r.duration_ms,
                            favorited:    false,
                            mime_type:    r.mime_type,
                            ingested_at:  0,
                            source_url:   None,
                        };
                        if let Err(e) = db.upsert_track_from_sync(&record).await {
                            eprintln!("[sync] upsert_track_from_sync: {e}");
                        }
                    }

                    for hash in &all_hashes {
                        if !fetched_hashes.contains(hash) {
                            let stub = TrackRecord {
                                hash:         hash.clone(),
                                title:        String::new(),
                                artist:       String::new(),
                                album:        None,
                                artwork_hash: None,
                                duration_ms:  0,
                                favorited:    false,
                                mime_type:    None,
                                ingested_at:  0,
                                source_url:   None,
                            };
                            if let Err(e) = db.upsert_track_from_sync(&stub).await {
                                eprintln!("[sync] upsert_track_from_sync (stub): {e}");
                            }
                        }
                    }
                }
            }
        }
    }

    db.import_commit_chain(&peer_commits).await?;

    let peer_head_owned = peer_commits.first()
        .map(|c| c.hash.clone())
        .unwrap_or_else(|| peer_entry.head_commit.clone());
    let peer_head = &peer_head_owned;

    let ancestor = match &local_head {
        None => {
            db.ensure_playlist_and_branch(&playlist_id, &peer_entry.name, local_branch_name).await?;
            db.update_branch_head(&playlist_id, local_branch_name, peer_head).await?;
            return Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts: vec![] });
        }
        Some(lh) => db.find_common_ancestor(lh, peer_head).await?,
    };

    let local_head_str = local_head.as_deref().expect("checked above");

    if ancestor.as_deref() == Some(peer_head) {
        return Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts: vec![] });
    }

    if ancestor.as_deref() == Some(local_head_str) {
        db.update_branch_head(&playlist_id, local_branch_name, peer_head).await?;
        return Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts: vec![] });
    }

    let our_tree   = db.read_tree_for_commit(&cas, local_head_str).await?;
    let their_tree = db.read_tree_for_commit(&cas, peer_head).await?;
    let base_tree  = match &ancestor {
        Some(h) => db.read_tree_for_commit(&cas, h).await?,
        None    => TreeBlob::new(""),
    };

    let (conflicts, merged_tree) = diff_trees(&base_tree, &our_tree, &their_tree);

    if !conflicts.is_empty() {
        let pending = PendingMerge {
            local_head:        local_head_str.to_string(),
            peer_head:         peer_head.to_string(),
            ancestor_hash:     ancestor.clone(),
            branch_name:       local_branch_name.to_string(),
            conflicts:         conflicts.clone(),
            peer_display_name: peer_display_name.to_string(),
        };
        // Lock is released before any await — no async hold across the lock boundary.
        pending_merges.lock().unwrap().insert(playlist_id.to_string(), pending);
        return Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts });
    }

    if let Some(tree) = merged_tree {
        let json = tree.to_json()
            .map_err(|e| SyncError::Io(std::io::Error::other(e.to_string())))?;
        let tree_hash = cas.write_blob(json.as_bytes()).await?;
        let merge_commit = CommitRecord {
            hash:      uuid::Uuid::new_v4().to_string(),
            tree_hash,
            timestamp: unix_now() as i64,
            device_id: identity.public_key_b64(),
            message:   Some(format!("auto-merge from {peer_display_name}")),
        };
        db.insert_commit(&merge_commit, &[local_head_str, peer_head]).await?;
        db.update_branch_head(&playlist_id, local_branch_name, &merge_commit.hash).await?;
    }

    Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts: vec![] })
}

// ── IosSyncBridge ─────────────────────────────────────────────────────────────

pub struct IosSyncBridge {
    identity: Arc<NodeIdentity>,
    peers: Arc<RwLock<Vec<PeerInfo>>>,
    discovery_open: Arc<AtomicBool>,
    data_dir: PathBuf,
    trust_list: Arc<RwLock<TrustList>>,
    /// Tokio-flavoured copy shared with the Axum HTTP server. Updated on every
    /// pairing so the server always sees the current trust list.
    http_trust_list: Arc<tokio::sync::RwLock<TrustList>>,
    /// Tokio-flavoured peers map shared with the Axum HTTP server (for /pair).
    http_peers_map: Arc<tokio::sync::RwLock<HashMap<String, PeerInfo>>>,
    db: Arc<Database>,
    cas: Arc<CasStore>,
    pending_merges: Arc<std::sync::Mutex<HashMap<String, PendingMerge>>>,
    pending_qr_token: Arc<std::sync::Mutex<Option<(String, u64)>>>,
}

impl IosSyncBridge {
    pub fn new(identity: NodeIdentity, data_dir: PathBuf, db: Arc<Database>, cas: Arc<CasStore>) -> Result<Self, SyncError> {
        // Write sync_name.txt from UIDevice.current.name if the file is missing
        // or still contains the generic "Melomaniac" fallback from a previous run.
        let name_file = data_dir.join("sync_name.txt");
        let existing = std::fs::read_to_string(&name_file)
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if existing.is_empty() || existing == "Melomaniac" || existing == "localhost" {
            let mut buf = vec![0i8; 256];
            unsafe { melo_get_device_name(buf.as_mut_ptr(), buf.len()) };
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            let device_name = buf[..end]
                .iter()
                .map(|&b| b as u8)
                .collect::<Vec<_>>();
            if let Ok(name) = std::str::from_utf8(&device_name) {
                let name = name.trim();
                if !name.is_empty() {
                    std::fs::write(&name_file, name).ok();
                }
            }
        }

        let trust_list_path = data_dir.join("known_devices.json");
        let trust_list = TrustList::load(&trust_list_path)?;
        let http_trust_list = Arc::new(tokio::sync::RwLock::new(trust_list.clone()));
        let instance = Self {
            identity: Arc::new(identity),
            peers: Arc::new(RwLock::new(Vec::new())),
            discovery_open: Arc::new(AtomicBool::new(false)),
            data_dir,
            trust_list: Arc::new(RwLock::new(trust_list)),
            http_trust_list,
            http_peers_map: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            db,
            cas,
            pending_merges: Arc::new(std::sync::Mutex::new(HashMap::new())),
            pending_qr_token: Arc::new(std::sync::Mutex::new(None)),
        };
        // Populate process-globals so the bare `extern "C"` callbacks can reach
        // the peer list and trust list. `.set()` is a no-op if already set,
        // which is fine — there is only one bridge instance per process.
        PEER_LIST.set(instance.peers.clone()).ok();
        TRUST_LIST.set(instance.trust_list.clone()).ok();
        Ok(instance)
    }
}

impl SyncBridge for IosSyncBridge {
    fn start_discovery(&self) -> Result<(), SyncError> {
        let port = std::env::var("MELO_SYNC_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(7700);

        eprintln!("[sync] iOS start_discovery: name='{}' pk={}… port={port}",
            self.identity.display_name,
            &self.identity.public_key_b64()[..8]);

        // Start the Axum HTTP server so Desktop can pull from iOS.
        let server_state = ServerState {
            identity:         self.identity.clone(),
            trust_list:       self.http_trust_list.clone(),
            peers_map:        self.http_peers_map.clone(),
            db:               self.db.clone(),
            cas:              self.cas.clone(),
            pending_qr_token: self.pending_qr_token.clone(),
        };
        let router = build_router(server_state);
        let bind_addr: SocketAddr = format!("0.0.0.0:{port}").parse().expect("valid bind address");

        tokio::spawn(async move {
            match tokio::net::TcpListener::bind(bind_addr).await {
                Ok(listener) => {
                    eprintln!("[sync] iOS HTTP server listening on {bind_addr}");
                    if let Err(e) = axum::serve(listener, router).await {
                        eprintln!("[sync] iOS HTTP server error: {e}");
                    }
                }
                Err(e) => eprintln!("[sync] iOS HTTP server bind error: {e}"),
            }
        });

        // Determine the local IP for the mDNS TXT addr field so peers can reach our server.
        let local_addr = local_ip()
            .map(|ip| format!("{ip}:{port}"))
            .unwrap_or_default();

        let pk      = std::ffi::CString::new(self.identity.public_key_b64()).unwrap_or_default();
        let name    = std::ffi::CString::new(self.identity.display_name.clone()).unwrap_or_default();
        let addr_c  = std::ffi::CString::new(local_addr.clone()).unwrap_or_default();
        eprintln!("[sync] iOS start_discovery: advertising addr={local_addr}");
        unsafe {
            melo_sync_register_service(pk.as_ptr(), name.as_ptr(), port, addr_c.as_ptr());
            melo_sync_start_discovery(on_peer_discovered, on_peer_lost);
        }
        eprintln!("[sync] iOS start_discovery: NWBrowser and NWListener started");
        Ok(())
    }

    fn stop_discovery(&self) -> Result<(), SyncError> {
        unsafe {
            melo_sync_unregister_service();
            melo_sync_stop_discovery();
        }
        Ok(())
    }

    fn peers(&self) -> Vec<PeerInfo> {
        self.peers
            .read()
            .map(|p| p.clone())
            .unwrap_or_default()
    }

    fn open_discovery_window(&self, _duration_secs: u64) {
        self.discovery_open.store(true, Ordering::Relaxed);
    }

    fn close_discovery_window(&self) {
        self.discovery_open.store(false, Ordering::Relaxed);
    }

    fn is_discovery_open(&self) -> bool {
        self.discovery_open.load(Ordering::Relaxed)
    }

    fn generate_qr_payload(&self) -> Result<QrPayload, SyncError> {
        let mut token_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut token_bytes);
        let token = B64.encode(token_bytes);
        let exp = unix_now() + 600;

        // Store token so /pair can verify it when Desktop scans this QR.
        *self.pending_qr_token.lock().unwrap() = Some((token.clone(), exp));

        let port = std::env::var("MELO_SYNC_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(7700);
        let addr = local_ip().map(|ip| format!("{ip}:{port}"));

        Ok(QrPayload {
            public_key_b64: self.identity.public_key_b64(),
            display_name: self.identity.display_name.clone(),
            addr,
            token,
            exp,
        })
    }

    fn accept_qr_pairing(&self, payload: QrPayload) -> Result<(), SyncError> {
        if unix_now() > payload.exp {
            return Err(SyncError::AuthFailed);
        }

        let device = KnownDevice {
            public_key_b64: payload.public_key_b64.clone(),
            display_name: payload.display_name.clone(),
            added_at: unix_now(),
        };

        {
            let mut list = self
                .trust_list
                .write()
                .map_err(|_| SyncError::IdentityError("trust list lock poisoned".into()))?;
            list.add(device.clone());
            list.save(&self.identity)?;
        }

        eprintln!("[sync] iOS: paired with '{}' ({}…)", payload.display_name, &payload.public_key_b64[..8.min(payload.public_key_b64.len())]);
        eprintln!("[sync] iOS: QR payload addr = {:?}", payload.addr);

        // Seed the peer list immediately from the QR addr so the desktop
        // appears in livePeers right after pairing without waiting for
        // mDNS discovery (which is unreliable across OS/platform boundaries).
        if let Some(ref addr_str) = payload.addr {
            if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                if let Some(peers_lock) = PEER_LIST.get() {
                    if let Ok(mut peers) = peers_lock.write() {
                        if !peers.iter().any(|p| p.public_key_b64 == payload.public_key_b64) {
                            peers.push(PeerInfo {
                                public_key_b64: payload.public_key_b64.clone(),
                                display_name: payload.display_name.clone(),
                                addr,
                                latency_ms: None,
                            });
                            eprintln!("[sync] iOS: seeded peer '{}' at {} from QR addr", payload.display_name, addr);
                        }
                    }
                }
            }
        }

        // Mirror the new device into the HTTP server's trust list immediately
        // so auth checks pass as soon as desktop tries to connect.
        // POST our own identity back to the desktop so it can add us to its
        // trust list (the QR payload only flows one way; /pair closes the loop).
        let http_trust_list = self.http_trust_list.clone();
        if let Some(addr) = payload.addr {
            let own_pk   = self.identity.public_key_b64();
            let own_name = self.identity.display_name.clone();
            let token    = payload.token;
            tokio::spawn(async move {
                {
                    let mut tl = http_trust_list.write().await;
                    tl.add(device);
                }
                let url = format!("http://{addr}/pair");
                eprintln!("[sync] iOS: POSTing identity to {url}");
                let body = serde_json::json!({
                    "public_key_b64": own_pk,
                    "display_name":   own_name,
                    "token":          token,
                });
                match http_client()
                    .post(&url)
                    .json(&body)
                    .send()
                    .await
                {
                    Ok(r)  => eprintln!("[sync] iOS: /pair response {}", r.status()),
                    Err(e) => eprintln!("[sync] iOS: /pair failed: {e}"),
                }
            });
        } else {
            eprintln!("[sync] iOS: QR payload had no addr — desktop won't be notified");
            tokio::spawn(async move {
                let mut tl = http_trust_list.write().await;
                tl.add(device);
            });
        }

        Ok(())
    }

    fn known_devices(&self) -> Vec<KnownDevice> {
        self.trust_list
            .read()
            .map(|l| l.devices())
            .unwrap_or_default()
    }

    fn remove_device(&self, public_key_b64: &str) -> Result<(), SyncError> {
        let mut list = self
            .trust_list
            .write()
            .map_err(|_| SyncError::IdentityError("trust list lock poisoned".into()))?;
        list.remove(public_key_b64);
        list.save(&self.identity)?;
        Ok(())
    }

    fn rename_device(&self, public_key_b64: &str, new_name: &str) -> Result<(), SyncError> {
        let mut list = self
            .trust_list
            .write()
            .map_err(|_| SyncError::IdentityError("trust list lock poisoned".into()))?;
        list.rename(public_key_b64, new_name.to_string());
        list.save(&self.identity)?;
        Ok(())
    }

    fn sync_playlist(
        &self,
        playlist_id: &str,
        branch_name: &str,
        peer_pk: Option<&str>,
        progress_tx: Option<std::sync::mpsc::SyncSender<super::SyncProgress>>,
    ) -> Result<SyncReport, SyncError> {
        let identity = self.identity.clone();
        let peers = self.peers.clone();
        let db = self.db.clone();
        let cas = self.cas.clone();
        let pending_merges = self.pending_merges.clone();
        let playlist_id = playlist_id.to_string();
        let branch_name = branch_name.to_string();
        let peer_pk = peer_pk.map(str::to_string);

        tokio::runtime::Handle::current().block_on(async move {
            let peer = {
                let list = peers.read().map_err(|_| {
                    SyncError::IdentityError("peers lock poisoned".into())
                })?;
                if let Some(ref pk) = peer_pk {
                    list.iter().find(|p| &p.public_key_b64 == pk).cloned()
                } else {
                    list.first().cloned()
                }
            };
            let peer = peer.ok_or(SyncError::NotPaired)?;
            let client = SyncClient {
                identity: Arc::clone(&identity),
                http: http_client(),
                base_url: format!("http://{}", peer.addr),
            };

            let manifest = client.get_manifest().await?;
            let peer_entry = match manifest.into_iter().find(|m| m.id == playlist_id) {
                Some(m) => m,
                None => return Ok(SyncReport { blobs_fetched: 0, bytes_fetched: 0, conflicts: vec![] }),
            };

            sync_one_branch_async(
                &client, identity, db, cas,
                &peer_entry, &branch_name, &peer.display_name,
                pending_merges, progress_tx,
            ).await
        })
    }

    fn sync_with_peer(&self, public_key_b64: &str) -> Result<SyncReport, SyncError> {
        let identity = self.identity.clone();
        let peers = self.peers.clone();
        let db = self.db.clone();
        let cas = self.cas.clone();
        let pending_merges = self.pending_merges.clone();
        let pk = public_key_b64.to_string();

        tokio::runtime::Handle::current().block_on(async move {
            let peer = {
                let list = peers.read().map_err(|_| {
                    SyncError::IdentityError("peers lock poisoned".into())
                })?;
                list.iter().find(|p| p.public_key_b64 == pk).cloned()
            };
            let peer = peer.ok_or_else(|| SyncError::PeerUnreachable(pk.clone()))?;
            let client = SyncClient {
                identity: Arc::clone(&identity),
                http: http_client(),
                base_url: format!("http://{}", peer.addr),
            };

            let manifest = client.get_manifest().await?;
            let local_ids: std::collections::HashSet<String> = db
                .get_all_playlists().await?
                .into_iter()
                .map(|p| p.id)
                .collect();

            let mut total = SyncReport { blobs_fetched: 0, bytes_fetched: 0, conflicts: vec![] };

            for entry in manifest {
                if !local_ids.contains(&entry.id) {
                    continue;
                }
                let local_branches = db.get_branches(&entry.id).await?;
                let changed: Vec<String> = entry.branches.iter()
                    .filter(|pb| {
                        let local_head = local_branches.iter()
                            .find(|lb| lb.name == pb.name)
                            .and_then(|lb| lb.head_commit.clone());
                        local_head.as_deref() != pb.head_commit.as_deref()
                    })
                    .map(|pb| pb.name.clone())
                    .collect();

                for branch_name in changed {
                    let report = sync_one_branch_async(
                        &client, identity.clone(), db.clone(), cas.clone(),
                        &entry, &branch_name, &peer.display_name,
                        pending_merges.clone(), None,
                    ).await?;
                    total.blobs_fetched += report.blobs_fetched;
                    total.bytes_fetched  += report.bytes_fetched;
                    total.conflicts.extend(report.conflicts);
                }
            }

            Ok(total)
        })
    }

    fn get_peer_manifest(&self, public_key_b64: &str) -> Result<Vec<PlaylistManifest>, SyncError> {
        let peers = Arc::clone(&self.peers);
        let identity = Arc::clone(&self.identity);
        let pk = public_key_b64.to_string();

        tokio::runtime::Handle::current().block_on(async move {
            let peer = {
                let list = peers.read().map_err(|_| {
                    SyncError::IdentityError("peers lock poisoned".into())
                })?;
                list.iter().find(|p| p.public_key_b64 == pk).cloned()
            };
            let peer = peer.ok_or_else(|| SyncError::PeerUnreachable(pk.clone()))?;
            let client = SyncClient {
                identity: Arc::clone(&identity),
                http: http_client(),
                base_url: format!("http://{}", peer.addr),
            };
            client.get_manifest().await
        })
    }

    fn fingerprint(&self) -> String {
        self.identity.fingerprint()
    }

    fn refresh_peer_metadata(
        &self,
        _public_key_b64: &str,
        _playlist_ids: &[String],
    ) -> Result<u32, SyncError> {
        Ok(0)
    }

    fn set_pending_merge(&self, playlist_id: &str, merge: PendingMerge) {
        self.pending_merges.lock().unwrap().insert(playlist_id.to_string(), merge);
    }

    fn pending_merge(&self, playlist_id: &str) -> Option<PendingMerge> {
        self.pending_merges.lock().unwrap().get(playlist_id).cloned()
    }

    fn clear_pending_merge(&self, playlist_id: &str) {
        self.pending_merges.lock().unwrap().remove(playlist_id);
    }
}
