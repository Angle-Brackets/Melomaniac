use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PlaylistManifest, QrPayload, SyncBridge, SyncError,
    SyncReport,
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
    // TODO Phase 1: return real playlist manifests once storage DAG is integrated
    axum::Json(Vec::<PlaylistManifest>::new()).into_response()
}

async fn handle_hashes(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }
    // TODO Phase 1: return real blob hash list from storage layer
    axum::Json(Vec::<String>::new()).into_response()
}

async fn handle_blob(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(_hash): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }
    // TODO Phase 1: serve blob bytes from storage layer
    (StatusCode::NOT_FOUND, axum::Json(serde_json::Value::Null)).into_response()
}

fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/ping", get(handle_ping))
        .route("/manifest", get(handle_manifest))
        .route("/hashes", get(handle_hashes))
        .route("/blob/:hash", get(handle_blob))
        .with_state(state)
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

    #[allow(dead_code)]
    fn sync_playlist(&self, _playlist_id: &str) -> Result<SyncReport, SyncError> {
        // TODO Phase 1: implement pull protocol
        Ok(SyncReport {
            blobs_fetched: 0,
            bytes_fetched: 0,
            conflicts: vec![],
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
}
