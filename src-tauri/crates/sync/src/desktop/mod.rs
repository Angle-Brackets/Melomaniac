use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PendingMerge,
    PlaylistManifest, QrPayload, SyncBridge, SyncError, SyncReport, TrackSyncRecord,
    identity::{TrustList, unix_now},
    merge::diff_trees,
    http_server::{ServerState, build_router},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::VerifyingKey;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use melomaniac_storage::{CasStore, CommitRecord, Database, TrackRecord, TreeBlob};
use rand::RngCore;
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::RwLock;

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_TYPE: &str = "_melomaniac._tcp.local.";
fn sync_port() -> u16 { crate::sync_port() }

// ── DesktopSyncBridge ─────────────────────────────────────────────────────────

pub struct DesktopSyncBridge {
    identity: Arc<NodeIdentity>,
    trust_list: Arc<RwLock<TrustList>>,
    /// pk_b64 → PeerInfo for currently reachable, trusted peers.
    peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    discovery_open: Arc<AtomicBool>,
    #[allow(dead_code)]
    data_dir: PathBuf,
    mdns: Arc<std::sync::Mutex<Option<ServiceDaemon>>>,
    db: Arc<Database>,
    cas: Arc<CasStore>,
    pending_merges: Arc<tokio::sync::Mutex<HashMap<String, PendingMerge>>>,
    /// Shared with the Axum ServerState so /pair can verify and consume it.
    pending_qr_token: Arc<std::sync::Mutex<Option<(String, u64)>>>,
}

impl DesktopSyncBridge {
    pub fn new(
        identity: NodeIdentity,
        data_dir: PathBuf,
        db: Arc<Database>,
        cas: Arc<CasStore>,
    ) -> Result<Self, SyncError> {
        let trust_list_path = data_dir.join("known_devices.json");
        let trust_list = TrustList::load(&trust_list_path)?;

        Ok(Self {
            identity: Arc::new(identity),
            trust_list: Arc::new(RwLock::new(trust_list)),
            peers: Arc::new(RwLock::new(HashMap::new())),
            discovery_open: Arc::new(AtomicBool::new(false)),
            data_dir,
            mdns: Arc::new(std::sync::Mutex::new(None)),
            db,
            cas,
            pending_merges: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_qr_token: Arc::new(std::sync::Mutex::new(None)),
        })
    }

    /// Register (or re-register) the mDNS service with the given `mode` TXT field.
    fn register_mdns_service(
        daemon: &ServiceDaemon,
        identity: &NodeIdentity,
        mode: &str,
        port: u16,
    ) -> Result<(), SyncError> {
        let pk_b64 = identity.public_key_b64();
        let hostname = local_hostname();
        let instance_name = format!("melomaniac-{}", &pk_b64[..8]);
        let ip_str = local_ip()
            .map(|ip| format!("{ip}:{port}"))
            .unwrap_or_default();

        let properties = [
            ("v", "1"),
            ("pk", pk_b64.as_str()),
            ("name", identity.display_name.as_str()),
            ("mode", mode),
            ("addr", ip_str.as_str()),
        ];

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &hostname,
            "",
            port,
            &properties[..],
        )
        .map_err(|e| SyncError::IdentityError(format!("mDNS ServiceInfo: {e}")))?;

        daemon
            .register(service)
            .map_err(|e| SyncError::IdentityError(format!("mDNS register: {e}")))?;

        eprintln!("[sync] mDNS registered: {} on port {port} (mode={mode})", identity.display_name);
        Ok(())
    }

    /// Spawn a Tokio task that browses for `_melomaniac._tcp.local.` peers and
    /// keeps `peers` up to date.
    fn spawn_browse_task(
        daemon: ServiceDaemon,
        own_pk: String,
        peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
        trust_list: Arc<RwLock<TrustList>>,
    ) {
        let receiver = match daemon.browse(SERVICE_TYPE) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[sync] mDNS browse error: {e}");
                return;
            }
        };

        tokio::spawn(async move {
            // Hold `daemon` alive for the lifetime of this task.
            let _daemon = daemon;

            while let Ok(event) = receiver.recv_async().await {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let props = info.get_properties();

                        let pk = match props.get("pk").map(|p| p.val_str().to_string()) {
                            Some(p) => p,
                            None => {
                                eprintln!("[sync] resolved service missing pk TXT key — skipping");
                                continue;
                            }
                        };

                        if pk == own_pk {
                            eprintln!("[sync] discovered own service — skipping");
                            continue;
                        }

                        let name = props
                            .get("name")
                            .map(|p| p.val_str().to_string())
                            .unwrap_or_else(|| "<unnamed>".into());
                        let mode = props
                            .get("mode")
                            .map(|p| p.val_str().to_string())
                            .unwrap_or_default();

                        let port = info.get_port();
                        let addrs: Vec<_> = info.get_addresses().iter().cloned().collect();
                        eprintln!("[sync] resolved peer: name={name} pk={}… mode={mode} port={port} addrs={addrs:?}", &pk[..8.min(pk.len())]);

                        let addr: Option<SocketAddr> = addrs
                            .iter()
                            .find_map(|ip| format!("{ip}:{port}").parse().ok());

                        let Some(addr) = addr else {
                            eprintln!("[sync] no usable address for {name} — skipping");
                            continue;
                        };

                        let tl = trust_list.read().await;
                        if tl.is_known(&pk) {
                            eprintln!("[sync] trusted peer online: {name} at {addr}");
                            drop(tl);
                            peers.write().await.insert(
                                pk.clone(),
                                PeerInfo {
                                    public_key_b64: pk,
                                    display_name: name,
                                    addr,
                                    latency_ms: None,
                                },
                            );
                        } else {
                            eprintln!("[sync] unknown peer: {name} pk={}… mode={mode} — not in trust list", &pk[..8.min(pk.len())]);
                            drop(tl);
                            if mode == "open" {
                                eprintln!("[sync] pairing-request from {name} at {addr}");
                            }
                        }
                    }

                    ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        eprintln!("[sync] service removed: {fullname}");
                        let mut map = peers.write().await;
                        let before = map.len();
                        map.retain(|_, v| !fullname.contains(&v.public_key_b64[..8]));
                        if map.len() < before {
                            eprintln!("[sync] peer removed, {} remaining", map.len());
                        }
                    }

                    _ => {}
                }
            }
        });
    }
}

// ── Network helpers ───────────────────────────────────────────────────────────

fn local_hostname() -> String {
    let raw = std::env::var("HOSTNAME")
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .unwrap_or_else(|_| "melomaniac".to_string());
    // mdns-sd requires the hostname to end with ".local." (trailing dot mandatory)
    let hostname = if raw.ends_with(".local.") {
        raw
    } else if raw.ends_with(".local") {
        format!("{raw}.")
    } else {
        format!("{raw}.local.")
    };
    eprintln!("[sync] mDNS hostname: {hostname:?}");
    hostname
}

/// Probe the OS routing table to find the preferred local non-loopback address.
/// Falls back to enumerating network interfaces on Unix if routing probe fails.
fn local_ip() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, UdpSocket};
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Some(ip @ IpAddr::V4(v4)) = socket.local_addr().ok().map(|a| a.ip()) {
                if v4 != Ipv4Addr::LOCALHOST {
                    eprintln!("[sync] local_ip (routing): {ip}");
                    return Some(ip);
                }
            }
        }
    }
    #[cfg(unix)]
    if let Some(ip) = local_ip_from_interfaces() {
        eprintln!("[sync] local_ip (getifaddrs fallback): {ip}");
        return Some(ip);
    }
    eprintln!("[sync] local_ip: could not determine non-loopback IPv4 address");
    None
}

/// Enumerate network interfaces and return the first non-loopback, non-link-local IPv4 address.
#[cfg(unix)]
fn local_ip_from_interfaces() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr};
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
                let sin = &*(addr_ptr as *const libc::sockaddr_in);
                let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                if !ip.is_loopback() && !ip.is_link_local() {
                    result = Some(IpAddr::V4(ip));
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

struct SyncClient {
    identity: Arc<NodeIdentity>,
    http: reqwest::Client,
    base_url: String,
}

impl SyncClient {
    fn new(identity: Arc<NodeIdentity>, addr: SocketAddr) -> Self {
        Self {
            identity,
            http: reqwest::Client::new(),
            base_url: format!("http://{addr}"),
        }
    }

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
            return Err(SyncError::BlobTransferFailed(format!("blob not found: {hash}")));
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

// ── Sync context bridge (sync → async) ───────────────────────────────────────

/// Block on `fut` using the current Tokio runtime handle.
///
/// Panics if called from outside a Tokio runtime context; all public methods on
/// `DesktopSyncBridge` are called from within a Tauri application, which always
/// runs a Tokio runtime.
fn block<F, T>(fut: F) -> T
where
    F: std::future::Future<Output = T>,
{
    // block_in_place hands this thread to blocking work and moves async tasks
    // elsewhere, so block_on doesn't panic when called from a Tokio worker.
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(fut)
    })
}

// ── Per-branch sync helper ────────────────────────────────────────────────────

/// Pull one playlist branch from `client` and merge it into the local DAG.
/// Shared by `sync_playlist` (single branch) and `sync_with_peer` (all changed
/// branches across the peer's full manifest).
async fn sync_one_branch_async(
    client: &SyncClient,
    identity: Arc<NodeIdentity>,
    db: Arc<Database>,
    cas: Arc<CasStore>,
    peer_entry: &PlaylistManifest,
    branch_name: &str,
    pending_merges: Arc<tokio::sync::Mutex<HashMap<String, PendingMerge>>>,
    progress_tx: Option<std::sync::mpsc::SyncSender<super::SyncProgress>>,
) -> Result<SyncReport, SyncError> {
    let playlist_id = peer_entry.id.clone();
    let local_branch_name = branch_name;

    let local_branches = db.get_branches(&playlist_id).await?;
    let local_head = local_branches.iter()
        .find(|b| b.name == branch_name)
        .and_then(|b| b.head_commit.clone());

    // Early-exit for the main branch when heads already match.
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

    // Insert track metadata so track_play can find records after download.
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

    let our_tree   = db.read_tree_for_commit(&*cas, local_head_str).await?;
    let their_tree = db.read_tree_for_commit(&*cas, peer_head).await?;
    let base_tree  = match &ancestor {
        Some(h) => db.read_tree_for_commit(&*cas, h).await?,
        None    => TreeBlob::new(""),
    };

    let (conflicts, merged_tree) = diff_trees(&base_tree, &our_tree, &their_tree);

    if !conflicts.is_empty() {
        let pending = PendingMerge {
            local_head:    local_head_str.to_string(),
            peer_head:     peer_head.to_string(),
            ancestor_hash: ancestor.clone(),
            branch_name:   local_branch_name.to_string(),
            conflicts:     conflicts.clone(),
        };
        pending_merges.lock().await.insert(playlist_id.to_string(), pending);
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
            message:   Some("auto-merge".into()),
        };
        db.insert_commit(&merge_commit, &[local_head_str, peer_head]).await?;
        db.update_branch_head(&playlist_id, local_branch_name, &merge_commit.hash).await?;
    }

    Ok(SyncReport { blobs_fetched, bytes_fetched, conflicts: vec![] })
}

// ── SyncBridge impl ───────────────────────────────────────────────────────────

impl SyncBridge for DesktopSyncBridge {
    fn start_discovery(&self) -> Result<(), SyncError> {
        eprintln!("[sync] start_discovery: called");
        let mut guard = self
            .mdns
            .lock()
            .map_err(|_| SyncError::IdentityError("mdns mutex poisoned".into()))?;

        if guard.is_some() {
            eprintln!("[sync] start_discovery: already running, skipping");
            return Ok(());
        }

        let port = sync_port();
        eprintln!("[sync] start_discovery: creating mDNS daemon (port={port})");
        let daemon = ServiceDaemon::new()
            .map_err(|e| { eprintln!("[sync] mDNS daemon creation failed: {e}"); SyncError::IdentityError(format!("mDNS daemon: {e}")) })?;

        eprintln!("[sync] start_discovery: registering mDNS service");
        Self::register_mdns_service(&daemon, &self.identity, "closed", port)?;

        Self::spawn_browse_task(
            daemon.clone(),
            self.identity.public_key_b64(),
            Arc::clone(&self.peers),
            Arc::clone(&self.trust_list),
        );

        let server_state = ServerState {
            identity: self.identity.clone(),
            trust_list: self.trust_list.clone(),
            peers_map: self.peers.clone(),
            db: self.db.clone(),
            cas: self.cas.clone(),
            pending_qr_token: self.pending_qr_token.clone(),
        };
        let router = build_router(server_state);
        let bind_addr: SocketAddr =
            format!("0.0.0.0:{port}").parse().expect("valid bind address");

        // Binds on all interfaces so both Wi-Fi and Ethernet peers can reach us.
        // If a peer can discover us via mDNS but HTTP requests time out, the most
        // likely culprit is wireless client isolation (sometimes called "AP isolation")
        // on the router — a setting that prevents Wi-Fi devices from talking directly
        // to each other or to wired devices on the same LAN. It is off by default on
        // home routers but common on guest networks. No OS-level firewall change is
        // needed; this is purely a router configuration issue.
        tokio::spawn(async move {
            match tokio::net::TcpListener::bind(bind_addr).await {
                Ok(listener) => {
                    eprintln!("[sync] HTTP server listening on {bind_addr}");
                    if let Err(e) = axum::serve(listener, router).await {
                        eprintln!("[sync] HTTP server error: {e}");
                    }
                }
                Err(e) => eprintln!("[sync] HTTP server bind error: {e}"),
            }
        });

        *guard = Some(daemon);
        Ok(())
    }

    fn stop_discovery(&self) -> Result<(), SyncError> {
        let mut guard = self
            .mdns
            .lock()
            .map_err(|_| SyncError::IdentityError("mdns mutex poisoned".into()))?;

        if let Some(daemon) = guard.take() {
            daemon
                .shutdown()
                .map_err(|e| SyncError::IdentityError(format!("mDNS shutdown: {e}")))?;
        }
        Ok(())
    }

    fn peers(&self) -> Vec<PeerInfo> {
        block(async { self.peers.read().await.values().cloned().collect() })
    }

    fn open_discovery_window(&self, duration_secs: u64) {
        self.discovery_open.store(true, Ordering::SeqCst);

        if let Ok(guard) = self.mdns.lock() {
            if let Some(daemon) = guard.as_ref() {
                let _ = Self::register_mdns_service(daemon, &self.identity, "open", sync_port());
            }
        }

        let flag = Arc::clone(&self.discovery_open);
        let identity = Arc::clone(&self.identity);
        let mdns = Arc::clone(&self.mdns);

        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(duration_secs)).await;
            flag.store(false, Ordering::SeqCst);
            if let Ok(guard) = mdns.lock() {
                if let Some(daemon) = guard.as_ref() {
                    let _ =
                        Self::register_mdns_service(daemon, &identity, "closed", sync_port());
                }
            }
        });
    }

    fn close_discovery_window(&self) {
        self.discovery_open.store(false, Ordering::SeqCst);
        if let Ok(guard) = self.mdns.lock() {
            if let Some(daemon) = guard.as_ref() {
                let _ =
                    Self::register_mdns_service(daemon, &self.identity, "closed", sync_port());
            }
        }
    }

    fn is_discovery_open(&self) -> bool {
        self.discovery_open.load(Ordering::SeqCst)
    }

    fn generate_qr_payload(&self) -> Result<QrPayload, SyncError> {
        let mut token_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut token_bytes);

        let port = sync_port();
        let addr = local_ip().map(|ip| format!("{ip}:{port}"));
        let token = B64.encode(token_bytes);
        let exp = unix_now() + 600;

        // Store so /pair can verify the scanning device is presenting our token.
        *self.pending_qr_token.lock().unwrap() = Some((token.clone(), exp));
        eprintln!("[sync] QR payload: addr={addr:?}");

        Ok(QrPayload {
            public_key_b64: self.identity.public_key_b64(),
            display_name: self.identity.display_name.clone(),
            addr,
            token,
            exp,
        })
    }

    fn accept_qr_pairing(&self, payload: QrPayload) -> Result<(), SyncError> {
        if payload.exp <= unix_now() {
            return Err(SyncError::AuthFailed);
        }

        let key_bytes = B64
            .decode(&payload.public_key_b64)
            .map_err(|_| SyncError::AuthFailed)?;
        let key_bytes32: [u8; 32] = key_bytes.try_into().map_err(|_| SyncError::AuthFailed)?;
        VerifyingKey::from_bytes(&key_bytes32).map_err(|_| SyncError::AuthFailed)?;

        let device = KnownDevice {
            public_key_b64: payload.public_key_b64.clone(),
            display_name: payload.display_name.clone(),
            added_at: unix_now(),
        };

        let identity = Arc::clone(&self.identity);
        let peers   = Arc::clone(&self.peers);
        block(async {
            let mut tl = self.trust_list.write().await;
            tl.add(device.clone());
            tl.save(&identity)?;
            drop(tl);

            // Immediately surface the peer so it shows up without waiting for
            // the next mDNS advertisement cycle.
            if let Some(addr_str) = &payload.addr {
                if let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() {
                    peers.write().await.insert(
                        device.public_key_b64.clone(),
                        PeerInfo {
                            public_key_b64: device.public_key_b64,
                            display_name:   device.display_name,
                            addr,
                            latency_ms: None,
                        },
                    );
                }
            }
            Ok(())
        })
    }

    fn known_devices(&self) -> Vec<KnownDevice> {
        block(async { self.trust_list.read().await.devices() })
    }

    fn remove_device(&self, public_key_b64: &str) -> Result<(), SyncError> {
        let pk = public_key_b64.to_string();
        let identity = Arc::clone(&self.identity);
        block(async {
            let mut tl = self.trust_list.write().await;
            tl.remove(&pk);
            tl.save(&identity)
        })
    }

    fn sync_playlist(
        &self,
        playlist_id: &str,
        branch_name: &str,
        progress_tx: Option<std::sync::mpsc::SyncSender<super::SyncProgress>>,
    ) -> Result<SyncReport, SyncError> {
        let identity = self.identity.clone();
        let peers = self.peers.clone();
        let db = self.db.clone();
        let cas = self.cas.clone();
        let pending_merges = self.pending_merges.clone();
        let playlist_id = playlist_id.to_string();
        let branch_name = branch_name.to_string();

        block(async move {
            let peer = peers.read().await.values().next().cloned()
                .ok_or(SyncError::NotPaired)?;
            let client = SyncClient::new(identity.clone(), peer.addr);

            let manifest = client.get_manifest().await?;
            let peer_entry = match manifest.into_iter().find(|m| m.id == playlist_id) {
                Some(m) => m,
                None => return Ok(SyncReport { blobs_fetched: 0, bytes_fetched: 0, conflicts: vec![] }),
            };

            sync_one_branch_async(
                &client, identity, db, cas,
                &peer_entry, &branch_name,
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

        block(async move {
            let peer = peers.read().await.get(&pk).cloned()
                .ok_or_else(|| SyncError::PeerUnreachable(pk.clone()))?;
            let client = SyncClient::new(identity.clone(), peer.addr);

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
                        &entry, &branch_name,
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

        block(async move {
            let peer = {
                let map = peers.read().await;
                map.get(&pk).cloned()
            };
            let peer = peer.ok_or(SyncError::PeerUnreachable(pk.clone()))?;
            let client = SyncClient::new(identity, peer.addr);
            client.get_manifest().await
        })
    }

    fn refresh_peer_metadata(
        &self,
        public_key_b64: &str,
        playlist_ids: &[String],
    ) -> Result<u32, SyncError> {
        let peers = Arc::clone(&self.peers);
        let identity = Arc::clone(&self.identity);
        let db = Arc::clone(&self.db);
        let cas = Arc::clone(&self.cas);
        let pk = public_key_b64.to_string();
        let playlist_ids = playlist_ids.to_vec();

        block(async move {
            let peer = {
                let map = peers.read().await;
                map.get(&pk).cloned()
            };
            let peer = peer.ok_or(SyncError::PeerUnreachable(pk))?;
            let client = SyncClient::new(identity, peer.addr);
            let local_hashes_snap: std::collections::HashSet<String> =
                cas.list_all_hashes().into_iter().collect();
            let mut artwork_downloaded: u32 = 0;

            for playlist_id in &playlist_ids {
                let branches = match db.get_branches(playlist_id).await {
                    Ok(b) => b,
                    Err(_) => continue,
                };
                let mut all_hashes: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                for branch in &branches {
                    let Some(ref hc) = branch.head_commit else { continue };
                    if let Ok(tree) = db.read_tree_for_commit(&*cas, hc).await {
                        for e in &tree.tracks {
                            all_hashes.insert(e.hash.clone());
                        }
                    }
                }
                if all_hashes.is_empty() {
                    continue;
                }
                let hashes_vec: Vec<String> = all_hashes.into_iter().collect();
                let fetched = match client.get_tracks(&hashes_vec).await {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                for r in fetched {
                    if let Some(ref art) = r.artwork_hash {
                        if !local_hashes_snap.contains(art) {
                            match client.get_blob(art).await {
                                Ok(bytes) => {
                                    if cas.write_blob(&bytes).await.is_ok() {
                                        artwork_downloaded += 1;
                                    }
                                }
                                Err(e) => eprintln!("[sync] metadata refresh: artwork {art}: {e}"),
                            }
                        }
                    }
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
                        eprintln!("[sync] metadata refresh upsert: {e}");
                    }
                }
            }

            Ok(artwork_downloaded)
        })
    }

    fn fingerprint(&self) -> String {
        self.identity.fingerprint()
    }

    fn set_pending_merge(&self, playlist_id: &str, merge: PendingMerge) {
        self.pending_merges.blocking_lock().insert(playlist_id.to_string(), merge);
    }

    fn pending_merge(&self, playlist_id: &str) -> Option<PendingMerge> {
        self.pending_merges.blocking_lock().get(playlist_id).cloned()
    }

    fn clear_pending_merge(&self, playlist_id: &str) {
        self.pending_merges.blocking_lock().remove(playlist_id);
    }
}
