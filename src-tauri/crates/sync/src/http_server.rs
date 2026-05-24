use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PlaylistManifest, TrackSyncRecord,
    identity::{TrustList, unix_now},
    sync_port,
};
use axum::{
    Router,
    extract::{ConnectInfo, Path, State},
    extract::Json,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use melomaniac_storage::{CommitRecord, Database, CasStore};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;

// ── ServerState ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub(crate) struct ServerState {
    pub(crate) identity:          Arc<NodeIdentity>,
    pub(crate) trust_list:        Arc<RwLock<TrustList>>,
    pub(crate) peers_map:         Arc<RwLock<HashMap<String, PeerInfo>>>,
    pub(crate) db:                Arc<Database>,
    pub(crate) cas:               Arc<CasStore>,
    /// Token stored when we generate a QR code; the scanning device POSTs it
    /// back to /pair so we can add it to our trust list.
    pub(crate) pending_qr_token:  Arc<std::sync::Mutex<Option<(String, u64)>>>,
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/// Verify a `"Melomaniac <pk_b64> <sig_b64>"` Authorization header.
///
/// The signed payload is the ASCII decimal Unix timestamp (seconds). Accepts
/// signatures over timestamps within ±30 s of the current server time.
pub(crate) fn verify_auth_header(header: &str, trust_list: &TrustList) -> bool {
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

// ── Auth guard ────────────────────────────────────────────────────────────────

pub(crate) async fn check_auth(
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

// ── Axum handlers ─────────────────────────────────────────────────────────────

pub(crate) async fn handle_ping(State(state): State<ServerState>) -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "pk":   state.identity.public_key_b64(),
        "name": state.identity.display_name,
        "ts":   unix_now(),
    }))
}

pub(crate) async fn handle_manifest(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let (db, cas) = (&state.db, &state.cas);

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

        let primary = branches.iter().find(|b| b.name == "main").or_else(|| branches.first());
        let Some(primary) = primary else { continue };
        let Some(head_commit) = primary.head_commit.clone() else { continue };

        let primary_tree = db.read_tree_for_commit(cas, &head_commit).await.ok();
        let (track_count, artwork_hash) = match &primary_tree {
            Some(t) => (t.tracks.len(), t.meta.artwork_hash.clone()),
            None => (0, None),
        };

        let size_bytes = primary_tree.as_ref().map(|t| {
            t.tracks.iter().map(|e| {
                std::fs::metadata(cas.blob_path(&e.hash)).map(|m| m.len()).unwrap_or(0)
            }).sum::<u64>()
        }).unwrap_or(0);

        let mut branch_infos: Vec<crate::BranchInfo> = Vec::with_capacity(branches.len());
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
            branch_infos.push(crate::BranchInfo {
                name: b.name.clone(),
                track_count: tree.tracks.len(),
                size_bytes: branch_size,
                track_hashes,
                head_commit: Some(hc.clone()),
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

pub(crate) async fn handle_hashes(
    State(state): State<ServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    axum::Json(state.cas.list_all_hashes()).into_response()
}

pub(crate) async fn handle_tracks(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(hashes): Json<Vec<String>>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    let db = &state.db;
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

pub(crate) async fn handle_blob(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    match state.cas.read_blob(&hash).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        ).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, axum::Json(serde_json::Value::Null)).into_response(),
    }
}

pub(crate) async fn handle_commits(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Path((playlist_id, branch_name)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(status) = check_auth(&headers, &state.trust_list).await {
        return (status, axum::Json(serde_json::Value::Null)).into_response();
    }

    match state.db.export_commit_chain(&playlist_id, &branch_name).await {
        Ok(commits) => axum::Json(commits).into_response(),
        Err(_) => axum::Json(Vec::<CommitRecord>::new()).into_response(),
    }
}

// ── /pair ─────────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub(crate) struct PairRequest {
    pub(crate) public_key_b64: String,
    pub(crate) display_name: String,
    pub(crate) token: String,
}

pub(crate) async fn handle_pair(
    ConnectInfo(remote_addr): ConnectInfo<SocketAddr>,
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
    *state.pending_qr_token.lock().unwrap() = None;

    let device = KnownDevice {
        public_key_b64: req.public_key_b64.clone(),
        display_name: req.display_name.clone(),
        added_at: unix_now(),
    };
    eprintln!("[sync] /pair: adding '{}' to trust list", req.display_name);
    let mut tl = state.trust_list.write().await;
    tl.add(device);
    tl.save(&state.identity).unwrap_or_else(|e| eprintln!("[sync] /pair: save error: {e}"));
    drop(tl);

    // Immediately surface the newly paired device as a live peer so it appears
    // in the UI without waiting for the next mDNS advertisement cycle.
    // The requester's sync server runs on the same IP as this HTTP connection,
    // on the well-known sync port.
    let peer_addr = SocketAddr::new(remote_addr.ip(), sync_port());
    state.peers_map.write().await.insert(
        req.public_key_b64.clone(),
        PeerInfo {
            public_key_b64: req.public_key_b64,
            display_name: req.display_name,
            addr: peer_addr,
            latency_ms: None,
        },
    );

    StatusCode::OK
}

// ── Router ────────────────────────────────────────────────────────────────────

pub(crate) fn build_router(state: ServerState) -> axum::extract::connect_info::IntoMakeServiceWithConnectInfo<Router, SocketAddr> {
    use axum::routing::post;
    use crate::routes as r;
    Router::new()
        .route(r::PING,    get(handle_ping))
        .route(r::MANIFEST, get(handle_manifest))
        .route(r::HASHES,  get(handle_hashes))
        .route(r::TRACKS,  post(handle_tracks))
        .route(r::BLOB,    get(handle_blob))
        .route(r::COMMITS, get(handle_commits))
        .route(r::PAIR,    post(handle_pair))
        .with_state(state)
        .into_make_service_with_connect_info::<SocketAddr>()
}
