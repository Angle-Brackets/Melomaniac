use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PendingMerge,
    PlaylistManifest, QrPayload, SyncBridge, SyncError, SyncReport, TrackSyncRecord,
    identity::{TrustList, unix_now},
    merge::diff_trees,
};
use axum::{
    Router,
    extract::{Path, State},
    extract::Json,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
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
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::RwLock;

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_TYPE: &str = "_melomaniac._tcp.local.";
const DEFAULT_PORT: u16 = 7700;

fn sync_port() -> u16 {
    std::env::var("MELO_SYNC_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

// ── Shared Axum server state ──────────────────────────────────────────────────

#[derive(Clone)]
struct ServerState {
    identity: Arc<NodeIdentity>,
    trust_list: Arc<RwLock<TrustList>>,
    db: Arc<OnceLock<Arc<Database>>>,
    cas: Arc<OnceLock<Arc<CasStore>>>,
    /// Token stored when we generate a QR code; the scanning device POSTs it
    /// back to /pair so we can add it to our trust list.
    pending_qr_token: Arc<std::sync::Mutex<Option<(String, u64)>>>,
}

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
    db: Arc<OnceLock<Arc<Database>>>,
    cas: Arc<OnceLock<Arc<CasStore>>>,
    pending_merges: Arc<tokio::sync::Mutex<HashMap<String, PendingMerge>>>,
    /// Shared with the Axum ServerState so /pair can verify and consume it.
    pending_qr_token: Arc<std::sync::Mutex<Option<(String, u64)>>>,
}

impl DesktopSyncBridge {
    pub fn new(identity: NodeIdentity, data_dir: PathBuf) -> Result<Self, SyncError> {
        let trust_list_path = data_dir.join("known_devices.json");
        let trust_list = TrustList::load(&trust_list_path)?;

        Ok(Self {
            identity: Arc::new(identity),
            trust_list: Arc::new(RwLock::new(trust_list)),
            peers: Arc::new(RwLock::new(HashMap::new())),
            discovery_open: Arc::new(AtomicBool::new(false)),
            data_dir,
            mdns: Arc::new(std::sync::Mutex::new(None)),
            db: Arc::new(OnceLock::new()),
            cas: Arc::new(OnceLock::new()),
            pending_merges: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            pending_qr_token: Arc::new(std::sync::Mutex::new(None)),
        })
    }

    pub fn set_storage(&self, db: Arc<Database>, cas: Arc<CasStore>) {
        self.db.set(db).ok();
        self.cas.set(cas).ok();
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

// ── Auth helper ───────────────────────────────────────────────────────────────

/// Verify a `"Melomaniac <pk_b64> <sig_b64>"` Authorization header.
///
/// The signed payload is the ASCII decimal Unix timestamp (seconds). Accepts
/// signatures over timestamps within ±30 s of the current server time.
fn verify_auth_header(header: &str, trust_list: &TrustList) -> bool {
    let Some(rest) = header.strip_prefix("Melomaniac ") else {
        return false;
    };
    let mut parts = rest.splitn(2, ' ');
    let (Some(pk_b64), Some(sig_b64)) = (parts.next(), parts.next()) else {
        return false;
    };

    if !trust_list.is_known(pk_b64) {
        return false;
    }

    let Ok(sig_bytes) = B64.decode(sig_b64) else {
        return false;
    };

    let now = unix_now();
    for delta in -30_i64..=30 {
        let ts = (now as i64 + delta) as u64;
        if NodeIdentity::verify(pk_b64, ts.to_string().as_bytes(), &sig_bytes) {
            return true;
        }
    }
    false
}

// ── Axum handlers ─────────────────────────────────────────────────────────────

async fn handle_ping(State(state): State<ServerState>) -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "pk":   state.identity.public_key_b64(),
        "name": state.identity.display_name,
        "ts":   unix_now(),
    }))
}

async fn check_auth(
    headers: &HeaderMap,
    trust_list: &RwLock<TrustList>,
) -> Result<(), StatusCode> {
    let auth_value = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let tl = trust_list.read().await;
    if verify_auth_header(auth_value, &tl) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

async fn handle_manifest(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let (Some(db), Some(cas)) = (state.db.get(), state.cas.get()) else {
        return axum::Json(Vec::<PlaylistManifest>::new()).into_response();
    };

    let playlists = match db.get_all_playlists().await {
        Ok(p) => p.into_iter().filter(|pl| pl.name != "DevelopmentOnly").collect::<Vec<_>>(),
        Err(_) => return axum::Json(Vec::<PlaylistManifest>::new()).into_response(),
    };

    let mut manifests = Vec::with_capacity(playlists.len());
    for playlist in playlists {
        let branches = match db.get_branches(&playlist.id).await {
            Ok(b) => b,
            Err(_) => continue,
        };

        let branch_count = branches.len();

        // Use the main branch for representative data, falling back to the first branch.
        let primary = branches.iter().find(|b| b.name == "main").or_else(|| branches.first());
        let Some(primary) = primary else { continue };
        let Some(head_commit) = primary.head_commit.clone() else { continue };

        let primary_tree = db.read_tree_for_commit(cas, &head_commit).await.ok();
        let (track_count, artwork_hash) = match &primary_tree {
            Some(t) => (t.tracks.len(), t.meta.artwork_hash.clone()),
            None => (0, None),
        };

        // Primary-branch size (fast path used for the top-level size_bytes field).
        let size_bytes = primary_tree.as_ref().map(|t| {
            t.tracks.iter().map(|e| {
                std::fs::metadata(cas.blob_path(&e.hash)).map(|m| m.len()).unwrap_or(0)
            }).sum::<u64>()
        }).unwrap_or(0);

        // Per-branch detail — track hashes + sizes so the receiver can deduplicate.
        let mut branch_infos: Vec<super::BranchInfo> = Vec::with_capacity(branches.len());
        for b in &branches {
            let Some(ref hc) = b.head_commit else { continue };
            let tree = if b.name == primary.name {
                primary_tree.clone()
            } else {
                db.read_tree_for_commit(cas, hc).await.ok()
            };
            let Some(tree) = tree else { continue };
            let mut branch_size: u64 = 0;
            let track_hashes: Vec<String> = tree.tracks.iter().map(|e| {
                branch_size += std::fs::metadata(cas.blob_path(&e.hash)).map(|m| m.len()).unwrap_or(0);
                e.hash.clone()
            }).collect();
            branch_infos.push(super::BranchInfo {
                name: b.name.clone(),
                track_count: tree.tracks.len(),
                size_bytes: branch_size,
                track_hashes,
            });
        }

        manifests.push(PlaylistManifest {
            id: playlist.id,
            name: playlist.name,
            description: playlist.description,
            branch_count,
            track_count,
            size_bytes,
            artwork_hash,
            head_commit,
            branches: branch_infos,
        });
    }

    axum::Json(manifests).into_response()
}

async fn handle_hashes(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let hashes = match state.cas.get() {
        Some(cas) => cas.list_all_hashes(),
        None => vec![],
    };

    axum::Json(hashes).into_response()
}

async fn handle_tracks(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(hashes): Json<Vec<String>>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let Some(db) = state.db.get() else {
        return axum::Json(Vec::<TrackSyncRecord>::new()).into_response();
    };

    let mut records = Vec::with_capacity(hashes.len());
    for hash in &hashes {
        if let Ok(Some(track)) = db.get_track(hash).await {
            records.push(TrackSyncRecord {
                hash: track.hash,
                title: track.title,
                artist: track.artist,
                album: track.album,
                artwork_hash: track.artwork_hash,
                duration_ms: track.duration_ms,
                mime_type: track.mime_type,
            });
        }
    }

    axum::Json(records).into_response()
}

async fn handle_blob(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let Some(cas) = state.cas.get() else {
        return (StatusCode::NOT_FOUND, axum::Json(serde_json::Value::Null)).into_response();
    };

    match cas.read_blob(&hash).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, axum::Json(serde_json::Value::Null)).into_response(),
    }
}

async fn handle_commits(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((playlist_id, branch_name)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let Some(db) = state.db.get() else {
        return axum::Json(Vec::<CommitRecord>::new()).into_response();
    };

    match db.export_commit_chain(&playlist_id, &branch_name).await {
        Ok(commits) => axum::Json(commits).into_response(),
        Err(_) => axum::Json(Vec::<CommitRecord>::new()).into_response(),
    }
}

// ── /pair — called by the scanning device after accepting our QR ──────────────

#[derive(serde::Deserialize)]
struct PairRequest {
    public_key_b64: String,
    display_name: String,
    token: String,
}

async fn handle_pair(
    State(state): State<ServerState>,
    Json(req): Json<PairRequest>,
) -> StatusCode {
    let now = unix_now();
    eprintln!("[sync] /pair: received from '{}' ({}…)", req.display_name, &req.public_key_b64[..8.min(req.public_key_b64.len())]);
    let valid = {
        let guard = state.pending_qr_token.lock().unwrap();
        match guard.as_ref() {
            None => {
                eprintln!("[sync] /pair: no pending token — QR was never generated or already used");
                false
            }
            Some((tok, exp)) => {
                let token_match = tok == &req.token;
                let not_expired = *exp > now;
                eprintln!("[sync] /pair: token_match={token_match} not_expired={not_expired} (exp={exp} now={now})");
                token_match && not_expired
            }
        }
    };
    if !valid {
        eprintln!("[sync] /pair: rejected — invalid or expired token");
        return StatusCode::UNAUTHORIZED;
    }
    // One-time use: clear so it can't be replayed.
    *state.pending_qr_token.lock().unwrap() = None;

    let device = KnownDevice {
        public_key_b64: req.public_key_b64,
        display_name: req.display_name.clone(),
        added_at: unix_now(),
    };
    eprintln!("[sync] /pair: adding '{}' to trust list", req.display_name);
    let mut tl = state.trust_list.write().await;
    tl.add(device);
    tl.save(&state.identity).unwrap_or_else(|e| eprintln!("[sync] /pair: save error: {e}"));
    StatusCode::OK
}

fn build_router(state: ServerState) -> Router {
    use axum::routing::post;
    Router::new()
        .route("/ping", get(handle_ping))
        .route("/manifest", get(handle_manifest))
        .route("/hashes", get(handle_hashes))
        .route("/tracks", post(handle_tracks))
        .route("/blob/:hash", get(handle_blob))
        .route("/commits/:playlist_id/:branch_name", get(handle_commits))
        .route("/pair", post(handle_pair))
        .with_state(state)
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
            .get(format!("{}/manifest", self.base_url))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        resp.json::<Vec<PlaylistManifest>>()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }

    async fn get_hashes(&self) -> Result<Vec<String>, SyncError> {
        let resp = self
            .http
            .get(format!("{}/hashes", self.base_url))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        resp.json::<Vec<String>>()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))
    }

    async fn get_blob(&self, hash: &str) -> Result<Vec<u8>, SyncError> {
        let resp = self
            .http
            .get(format!("{}/blob/{hash}", self.base_url))
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SyncError::BlobTransferFailed(e.to_string()))?;

        if resp.status() == StatusCode::NOT_FOUND {
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
            .get(format!("{}/commits/{playlist_id}/{branch}", self.base_url))
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
            .post(format!("{}/tracks", self.base_url))
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
            identity: Arc::clone(&self.identity),
            trust_list: Arc::clone(&self.trust_list),
            db: Arc::clone(&self.db),
            cas: Arc::clone(&self.cas),
            pending_qr_token: Arc::clone(&self.pending_qr_token),
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
            public_key_b64: payload.public_key_b64,
            display_name: payload.display_name,
            added_at: unix_now(),
        };

        let identity = Arc::clone(&self.identity);
        block(async {
            let mut tl = self.trust_list.write().await;
            tl.add(device);
            tl.save(&identity)
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
        let identity = Arc::clone(&self.identity);
        let peers = Arc::clone(&self.peers);
        let db = self.db.get().cloned().ok_or(SyncError::Io(std::io::Error::other("storage not initialised")))?;
        let cas = self.cas.get().cloned().ok_or(SyncError::Io(std::io::Error::other("storage not initialised")))?;
        let playlist_id = playlist_id.to_string();
        let branch_name = branch_name.to_string();

        block(async move {
            // 1. Pick best peer.
            let peer = {
                let map = peers.read().await;
                map.values().next().cloned()
            };
            let peer = peer.ok_or(SyncError::NotPaired)?;

            // 2. Build client.
            let client = SyncClient::new(identity.clone(), peer.addr);

            // 3. GET manifest from peer.
            let manifest = client.get_manifest().await?;
            let peer_entry = match manifest.into_iter().find(|m| m.id == playlist_id) {
                Some(m) => m,
                None => {
                    return Ok(SyncReport {
                        blobs_fetched: 0,
                        bytes_fetched: 0,
                        conflicts: vec![],
                    });
                }
            };


            // 4. Read local branch state for the requested branch.
            let local_branches = db.get_branches(&playlist_id).await?;
            let local_branch = local_branches.iter().find(|b| b.name == branch_name);
            let local_branch_name = branch_name.as_str();
            let local_head = local_branch.and_then(|b| b.head_commit.clone());

            // 5. Compare heads — only meaningful for the "main" branch since that's what
            // the manifest's head_commit reflects.
            if branch_name == "main" && local_head.as_deref() == Some(&peer_entry.head_commit) {
                return Ok(SyncReport {
                    blobs_fetched: 0,
                    bytes_fetched: 0,
                    conflicts: vec![],
                });
            }

            // 6. Fetch commit chain for the requested branch.
            let peer_commits = client.get_commits(&playlist_id, &branch_name).await?;

            // 7. Walk each commit's tree: fetch missing tree blobs, collect track/artwork hashes.
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

            // 8. Download missing track + artwork blobs (only what this playlist needs).
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

            // 8b. Insert track metadata into the local tracks table so track_play can find them.
            // Strategy (in priority order):
            //   1. Use metadata embedded in the tree blob (new format, zero extra round-trips).
            //   2. Fetch missing metadata from the peer's /tracks endpoint (old trees).
            //   3. Insert a stub record (hash only) so track_play never fails with "not found".
            if let Some(head_commit) = peer_commits.first() {
                if let Ok(tree_bytes) = cas.read_blob(&head_commit.tree_hash).await {
                    if let Ok(tree) = TreeBlob::from_bytes(&tree_bytes) {
                        let mut need_http: Vec<String> = Vec::new();

                        // Pass 1: embedded metadata.
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
                                db.upsert_track_from_sync(&record).await.ok();
                            } else {
                                need_http.push(entry.hash.clone());
                            }
                        }

                        // Pass 2: HTTP fallback for tracks without embedded metadata.
                        if !need_http.is_empty() {
                            let fetched = client.get_tracks(&need_http).await.unwrap_or_default();
                            let fetched_hashes: std::collections::HashSet<String> =
                                fetched.iter().map(|r| r.hash.clone()).collect();
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
                                db.upsert_track_from_sync(&record).await.ok();
                            }
                            // Pass 3: stub record so track_play never fails.
                            for hash in &need_http {
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
                                    db.upsert_track_from_sync(&stub).await.ok();
                                }
                            }
                        }
                    }
                }
            }

            // 9. Import commits into local DAG.
            db.import_commit_chain(&peer_commits).await?;

            // 11. DAG merge.
            // peer_commits[0] is the branch HEAD (export_commit_chain starts from HEAD).
            // Fall back to peer_entry.head_commit only for the main branch.
            let peer_head_owned = peer_commits.first()
                .map(|c| c.hash.clone())
                .unwrap_or_else(|| peer_entry.head_commit.clone());
            let peer_head = &peer_head_owned;

            let ancestor = match &local_head {
                None => {
                    // New playlist — create the playlist and branch rows before updating head.
                    db.ensure_playlist_and_branch(&playlist_id, &peer_entry.name, local_branch_name).await?;
                    db.update_branch_head(&playlist_id, local_branch_name, peer_head).await?;
                    return Ok(SyncReport {
                        blobs_fetched,
                        bytes_fetched,
                        conflicts: vec![],
                    });
                }
                Some(lh) => db.find_common_ancestor(lh, peer_head).await?,
            };

            let local_head = local_head.as_deref().expect("checked above");

            // b. We're ahead — nothing to do.
            if ancestor.as_deref() == Some(peer_head) {
                return Ok(SyncReport {
                    blobs_fetched,
                    bytes_fetched,
                    conflicts: vec![],
                });
            }

            // c. Fast-forward: our head is the ancestor.
            if ancestor.as_deref() == Some(local_head) {
                db.update_branch_head(&playlist_id, local_branch_name, peer_head).await?;
                return Ok(SyncReport {
                    blobs_fetched,
                    bytes_fetched,
                    conflicts: vec![],
                });
            }

            // d. True merge.
            let our_tree = db.read_tree_for_commit(&*cas, local_head).await?;
            let their_tree = db.read_tree_for_commit(&*cas, peer_head).await?;

            let base_tree = match &ancestor {
                Some(ancestor_hash) => db.read_tree_for_commit(&*cas, ancestor_hash).await?,
                None => TreeBlob::new(""),
            };

            let (conflicts, merged_tree) = diff_trees(&base_tree, &our_tree, &their_tree);

            if !conflicts.is_empty() {
                let pending = PendingMerge {
                    local_head:    local_head.to_string(),
                    peer_head:     peer_head.to_string(),
                    ancestor_hash: ancestor.clone(),
                    branch_name:   local_branch_name.to_string(),
                    conflicts:     conflicts.clone(),
                };
                self.pending_merges.blocking_lock().insert(playlist_id.to_string(), pending);
                return Ok(SyncReport {
                    blobs_fetched,
                    bytes_fetched,
                    conflicts,
                });
            }

            // Auto-merge: write merged tree and create merge commit.
            if let Some(tree) = merged_tree {
                let json = tree.to_json().map_err(|e| {
                    SyncError::Io(std::io::Error::other(e.to_string()))
                })?;
                let tree_hash = cas.write_blob(json.as_bytes()).await?;

                let merge_commit = CommitRecord {
                    hash: uuid::Uuid::new_v4().to_string(),
                    tree_hash,
                    timestamp: unix_now() as i64,
                    device_id: identity.public_key_b64(),
                    message: Some("auto-merge".into()),
                };
                db.insert_commit(&merge_commit, &[local_head, peer_head]).await?;
                db.update_branch_head(&playlist_id, local_branch_name, &merge_commit.hash).await?;
            }

            Ok(SyncReport {
                blobs_fetched,
                bytes_fetched,
                conflicts: vec![],
            })
        })
    }

    #[allow(dead_code)]
    fn sync_with_peer(&self, _public_key_b64: &str) -> Result<SyncReport, SyncError> {
        // TODO Phase 1: implement pull protocol
        Ok(SyncReport {
            blobs_fetched: 0,
            bytes_fetched: 0,
            conflicts: vec![],
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
