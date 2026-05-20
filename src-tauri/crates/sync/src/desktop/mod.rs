use crate::{
    ConflictChunk, ConflictKind, KnownDevice, NodeIdentity, PeerInfo, PendingMerge,
    PlaylistManifest, QrPayload, SyncBridge, SyncError, SyncReport,
    identity::{TrustList, unix_now},
};
use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::VerifyingKey;
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use melomaniac_storage::{CasStore, CommitRecord, Database, TreeBlob};
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
    db: Arc<RwLock<Option<Arc<Database>>>>,
    cas: Arc<RwLock<Option<Arc<CasStore>>>>,
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
    db: Arc<RwLock<Option<Arc<Database>>>>,
    cas: Arc<RwLock<Option<Arc<CasStore>>>>,
    pending_merges: Arc<tokio::sync::Mutex<HashMap<String, PendingMerge>>>,
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
            db: Arc::new(RwLock::new(None)),
            cas: Arc::new(RwLock::new(None)),
            pending_merges: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        })
    }

    pub fn set_storage(&self, db: Arc<Database>, cas: Arc<CasStore>) {
        block(async {
            *self.db.write().await = Some(db);
            *self.cas.write().await = Some(cas);
        });
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

        let properties = [
            ("v", "1"),
            ("pk", pk_b64.as_str()),
            ("name", identity.display_name.as_str()),
            ("mode", mode),
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
                            None => continue,
                        };

                        if pk == own_pk {
                            continue;
                        }

                        let name = props
                            .get("name")
                            .map(|p| p.val_str().to_string())
                            .unwrap_or_default();
                        let mode = props
                            .get("mode")
                            .map(|p| p.val_str().to_string())
                            .unwrap_or_default();

                        let port = info.get_port();
                        let addr: Option<SocketAddr> = info
                            .get_addresses()
                            .iter()
                            .find_map(|ip| format!("{ip}:{port}").parse().ok());

                        let Some(addr) = addr else { continue };

                        let tl = trust_list.read().await;
                        if tl.is_known(&pk) {
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
                            drop(tl);
                            // Unknown peer. If their discovery window is open, log for
                            // potential pairing. Tauri handle is not available at this layer.
                            // TODO: emit Tauri event `sync://pairing-request` with { pk, name, addr }
                            if mode == "open" {
                                eprintln!(
                                    "[sync] pairing-request from {name} ({pk}) at {addr}"
                                );
                            }
                        }
                    }

                    ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        let mut map = peers.write().await;
                        map.retain(|_, v| !fullname.contains(&v.public_key_b64[..8]));
                    }

                    _ => {}
                }
            }
        });
    }
}

// ── Network helpers ───────────────────────────────────────────────────────────

fn local_hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .unwrap_or_else(|_| "melomaniac.local".to_string())
}

/// Probe the OS routing table to find the preferred local non-loopback address.
fn local_ip() -> Option<std::net::IpAddr> {
    use std::net::{IpAddr, Ipv4Addr, UdpSocket};
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        ip @ IpAddr::V4(v4) if v4 != Ipv4Addr::LOCALHOST => Some(ip),
        _ => None,
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

    let db_guard = state.db.read().await;
    let cas_guard = state.cas.read().await;
    let (Some(db), Some(cas)) = (db_guard.as_ref(), cas_guard.as_ref()) else {
        return axum::Json(Vec::<PlaylistManifest>::new()).into_response();
    };

    let playlists = match db.get_all_playlists().await {
        Ok(p) => p,
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

        let size_bytes = db
            .playlist_total_bytes(cas, &playlist.id, &primary.name)
            .await
            .unwrap_or(0);

        let tree = db.read_tree_for_commit(cas, &head_commit).await.ok();
        let (track_count, artwork_hash) = match &tree {
            Some(t) => (t.tracks.len(), t.meta.artwork_hash.clone()),
            None => (0, None),
        };

        manifests.push(PlaylistManifest {
            id: playlist.id,
            name: playlist.name,
            branch_count,
            track_count,
            size_bytes,
            artwork_hash,
            head_commit,
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

    let cas_guard = state.cas.read().await;
    let hashes = match cas_guard.as_ref() {
        Some(cas) => cas.list_all_hashes(),
        None => vec![],
    };

    axum::Json(hashes).into_response()
}

async fn handle_blob(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let cas_guard = state.cas.read().await;
    let Some(cas) = cas_guard.as_ref() else {
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

    let db_guard = state.db.read().await;
    let Some(db) = db_guard.as_ref() else {
        return axum::Json(Vec::<CommitRecord>::new()).into_response();
    };

    match db.export_commit_chain(&playlist_id, &branch_name).await {
        Ok(commits) => axum::Json(commits).into_response(),
        Err(_) => axum::Json(Vec::<CommitRecord>::new()).into_response(),
    }
}

fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/ping", get(handle_ping))
        .route("/manifest", get(handle_manifest))
        .route("/hashes", get(handle_hashes))
        .route("/blob/:hash", get(handle_blob))
        .route("/commits/:playlist_id/:branch_name", get(handle_commits))
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
}

// ── Tree diff ─────────────────────────────────────────────────────────────────

/// Compare three tree versions and return conflicts plus an auto-merged tree if there are none.
fn diff_trees(
    base: &TreeBlob,
    ours: &TreeBlob,
    theirs: &TreeBlob,
) -> (Vec<ConflictChunk>, Option<TreeBlob>) {
    let mut conflicts = Vec::new();

    // ── Metadata conflict ─────────────────────────────────────────────────────
    if ours.meta.name != theirs.meta.name
        && ours.meta.name != base.meta.name
        && theirs.meta.name != base.meta.name
    {
        conflicts.push(ConflictChunk {
            id: uuid::Uuid::new_v4().to_string(),
            kind: ConflictKind::MetadataEdit,
            ours: serde_json::json!(ours.meta.name),
            theirs: serde_json::json!(theirs.meta.name),
            context: serde_json::json!(base.meta.name),
        });
    }

    // ── Track order conflict ──────────────────────────────────────────────────
    let base_hashes: Vec<&str> = base.tracks.iter().map(|t| t.hash.as_str()).collect();
    let our_hashes: Vec<&str> = ours.tracks.iter().map(|t| t.hash.as_str()).collect();
    let their_hashes: Vec<&str> = theirs.tracks.iter().map(|t| t.hash.as_str()).collect();

    let our_set: std::collections::HashSet<&str> = our_hashes.iter().copied().collect();
    let their_set: std::collections::HashSet<&str> = their_hashes.iter().copied().collect();

    if our_set == their_set && our_hashes != their_hashes && our_hashes != base_hashes && their_hashes != base_hashes {
        conflicts.push(ConflictChunk {
            id: uuid::Uuid::new_v4().to_string(),
            kind: ConflictKind::TrackOrder,
            ours: serde_json::json!(our_hashes),
            theirs: serde_json::json!(their_hashes),
            context: serde_json::json!(base_hashes),
        });
    }

    // ── Track deletion vs modification ────────────────────────────────────────
    for base_track in &base.tracks {
        let in_ours = ours.tracks.iter().any(|t| t.hash == base_track.hash);
        let in_theirs = theirs.tracks.iter().any(|t| t.hash == base_track.hash);

        if !in_ours && in_theirs {
            // We deleted it; they kept/modified it.
            let their_version = theirs.tracks.iter().find(|t| t.hash == base_track.hash);
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::TrackDeletedVsModified,
                ours: serde_json::Value::Null,
                theirs: serde_json::to_value(their_version).unwrap_or(serde_json::Value::Null),
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        } else if in_ours && !in_theirs {
            // They deleted it; we kept/modified it.
            let our_version = ours.tracks.iter().find(|t| t.hash == base_track.hash);
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::TrackDeletedVsModified,
                ours: serde_json::to_value(our_version).unwrap_or(serde_json::Value::Null),
                theirs: serde_json::Value::Null,
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        }
    }

    // ── A/B loop point conflicts ──────────────────────────────────────────────
    for our_track in &ours.tracks {
        let Some(their_track) = theirs.tracks.iter().find(|t| t.hash == our_track.hash) else {
            continue;
        };
        let base_track = base.tracks.iter().find(|t| t.hash == our_track.hash);

        let ab_differs = our_track.ab_start_ms != their_track.ab_start_ms
            || our_track.ab_end_ms != their_track.ab_end_ms;

        let both_changed = if let Some(bt) = base_track {
            (our_track.ab_start_ms != bt.ab_start_ms || our_track.ab_end_ms != bt.ab_end_ms)
                && (their_track.ab_start_ms != bt.ab_start_ms
                    || their_track.ab_end_ms != bt.ab_end_ms)
        } else {
            // Track is new (added on both sides with different ab points — treat as conflict)
            ab_differs
        };

        if ab_differs && both_changed {
            conflicts.push(ConflictChunk {
                id: uuid::Uuid::new_v4().to_string(),
                kind: ConflictKind::AbLoopPoints,
                ours: serde_json::json!({
                    "hash": our_track.hash,
                    "ab_start_ms": our_track.ab_start_ms,
                    "ab_end_ms": our_track.ab_end_ms,
                }),
                theirs: serde_json::json!({
                    "hash": their_track.hash,
                    "ab_start_ms": their_track.ab_start_ms,
                    "ab_end_ms": their_track.ab_end_ms,
                }),
                context: serde_json::to_value(base_track).unwrap_or(serde_json::Value::Null),
            });
        }
    }

    if !conflicts.is_empty() {
        return (conflicts, None);
    }

    // ── Auto-merge ────────────────────────────────────────────────────────────
    let base_set: std::collections::HashSet<&str> = base_hashes.iter().copied().collect();

    // Keep all tracks from ours that are in base (respecting our ordering + deletions)
    // then add new tracks from theirs (not in base) at the end.
    let mut merged_tracks: Vec<melomaniac_storage::TrackEntry> = ours
        .tracks
        .iter()
        .filter(|t| base_set.contains(t.hash.as_str()) || their_set.contains(t.hash.as_str()))
        .cloned()
        .collect();

    // Apply theirs' deletions: remove tracks that theirs deleted (present in base, absent in theirs).
    merged_tracks.retain(|t| {
        !base_set.contains(t.hash.as_str()) || their_set.contains(t.hash.as_str())
    });

    // Append tracks added only by theirs (not in base, not already in merged).
    let their_additions: Vec<melomaniac_storage::TrackEntry> = {
        let merged_hashes: std::collections::HashSet<&str> =
            merged_tracks.iter().map(|t| t.hash.as_str()).collect();
        theirs
            .tracks
            .iter()
            .filter(|t| {
                !base_set.contains(t.hash.as_str())
                    && !merged_hashes.contains(t.hash.as_str())
            })
            .cloned()
            .collect()
    };
    merged_tracks.extend(their_additions);

    // Merge metadata: if only one side changed a field, take that side's value.
    let merged_name = if ours.meta.name != base.meta.name {
        ours.meta.name.clone()
    } else {
        theirs.meta.name.clone()
    };

    let merged_desc = if ours.meta.description != base.meta.description {
        ours.meta.description.clone()
    } else {
        theirs.meta.description.clone()
    };

    let merged_artwork = if ours.meta.artwork_hash != base.meta.artwork_hash {
        ours.meta.artwork_hash.clone()
    } else {
        theirs.meta.artwork_hash.clone()
    };

    let merged_tree = TreeBlob {
        v: 2,
        meta: melomaniac_storage::PlaylistMeta {
            name: merged_name,
            description: merged_desc,
            artwork_hash: merged_artwork,
            extra: Default::default(),
        },
        tracks: merged_tracks,
        includes: ours.includes.clone(),
        extra: Default::default(),
    };

    (vec![], Some(merged_tree))
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
    tokio::runtime::Handle::current().block_on(fut)
}

// ── SyncBridge impl ───────────────────────────────────────────────────────────

impl SyncBridge for DesktopSyncBridge {
    fn start_discovery(&self) -> Result<(), SyncError> {
        let mut guard = self
            .mdns
            .lock()
            .map_err(|_| SyncError::IdentityError("mdns mutex poisoned".into()))?;

        if guard.is_some() {
            return Ok(());
        }

        let port = sync_port();
        let daemon = ServiceDaemon::new()
            .map_err(|e| SyncError::IdentityError(format!("mDNS daemon: {e}")))?;

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
        };
        let router = build_router(server_state);
        let bind_addr: SocketAddr =
            format!("0.0.0.0:{port}").parse().expect("valid bind address");

        tokio::spawn(async move {
            match tokio::net::TcpListener::bind(bind_addr).await {
                Ok(listener) => {
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

        Ok(QrPayload {
            public_key_b64: self.identity.public_key_b64(),
            display_name: self.identity.display_name.clone(),
            addr,
            token: B64.encode(token_bytes),
            exp: unix_now() + 600,
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

    fn sync_playlist(&self, playlist_id: &str) -> Result<SyncReport, SyncError> {
        let identity = Arc::clone(&self.identity);
        let peers = Arc::clone(&self.peers);
        let db_lock = Arc::clone(&self.db);
        let cas_lock = Arc::clone(&self.cas);
        let playlist_id = playlist_id.to_string();

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

            let db_guard = db_lock.read().await;
            let cas_guard = cas_lock.read().await;
            let db = db_guard.as_ref().ok_or_else(|| {
                SyncError::Io(std::io::Error::other("storage not initialised"))
            })?;
            let cas = cas_guard.as_ref().ok_or_else(|| {
                SyncError::Io(std::io::Error::other("storage not initialised"))
            })?;

            // 4. Read local branch list and pick main branch.
            let local_branches = db.get_branches(&playlist_id).await?;
            let local_branch = local_branches
                .iter()
                .find(|b| b.name == "main")
                .or_else(|| local_branches.first());
            let local_branch_name = local_branch.map(|b| b.name.as_str()).unwrap_or("main");
            let local_head = local_branch.and_then(|b| b.head_commit.clone());

            // 5. Compare heads.
            if local_head.as_deref() == Some(&peer_entry.head_commit) {
                return Ok(SyncReport {
                    blobs_fetched: 0,
                    bytes_fetched: 0,
                    conflicts: vec![],
                });
            }

            // 6 & 7. Fetch hash sets.
            let peer_hashes = client.get_hashes().await?;
            let local_hashes: std::collections::HashSet<String> =
                cas.list_all_hashes().into_iter().collect();
            let peer_hash_set: std::collections::HashSet<String> =
                peer_hashes.into_iter().collect();

            // 8. Missing hashes = peer has them, we don't.
            let missing: Vec<String> = peer_hash_set
                .difference(&local_hashes)
                .cloned()
                .collect();

            // 9. Pull all missing blobs.
            let mut blobs_fetched: usize = 0;
            let mut bytes_fetched: u64 = 0;
            for hash in &missing {
                let bytes = client.get_blob(hash).await?;
                bytes_fetched += bytes.len() as u64;
                cas.write_blob(&bytes).await?;
                blobs_fetched += 1;
            }

            // 10. Import commit chain.
            let peer_commits = client.get_commits(&playlist_id, "main").await?;
            db.import_commit_chain(&peer_commits).await?;

            // 11. DAG merge.
            let peer_head = &peer_entry.head_commit;

            let ancestor = match &local_head {
                None => {
                    // We have no local commits — fast-forward to peer head.
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
            let our_tree = db.read_tree_for_commit(cas, local_head).await?;
            let their_tree = db.read_tree_for_commit(cas, peer_head).await?;

            let base_tree = match &ancestor {
                Some(ancestor_hash) => db.read_tree_for_commit(cas, ancestor_hash).await?,
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
