use crate::identity::{TrustList, unix_now};
use crate::merge::diff_trees;
use crate::{
    KnownDevice, NodeIdentity, PeerInfo, PendingMerge, PlaylistManifest, QrPayload, SyncBridge,
    SyncError, SyncReport,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use melomaniac_storage::{CasStore, CommitRecord, Database, TreeBlob};
use rand::RngCore;
use rand::rngs::OsRng;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ── Swift FFI ─────────────────────────────────────────────────────────────────

unsafe extern "C" {
    fn melo_sync_start_discovery(
        on_discovered: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
        on_lost: extern "C" fn(*const std::ffi::c_char),
    );
    fn melo_sync_stop_discovery();
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

    // Only add trusted peers.
    let Some(trust) = TRUST_LIST.get() else { return };
    let Ok(tl) = trust.read() else { return };
    if !tl.is_known(&pk) {
        return;
    }
    drop(tl);

    let Ok(addr) = addr_str.parse::<std::net::SocketAddr>() else { return };

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

// ── HTTP client ───────────────────────────────────────────────────────────────

struct SyncClient {
    identity: Arc<NodeIdentity>,
    http: reqwest::Client,
    base_url: String,
}

impl SyncClient {
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

// ── IosSyncBridge ─────────────────────────────────────────────────────────────

pub struct IosSyncBridge {
    identity: Arc<NodeIdentity>,
    peers: Arc<RwLock<Vec<PeerInfo>>>,
    discovery_open: Arc<AtomicBool>,
    data_dir: PathBuf,
    trust_list: Arc<RwLock<TrustList>>,
    db: Arc<OnceLock<Arc<Database>>>,
    cas: Arc<OnceLock<Arc<CasStore>>>,
}

impl IosSyncBridge {
    pub fn new(identity: NodeIdentity, data_dir: PathBuf) -> Result<Self, SyncError> {
        let trust_list_path = data_dir.join("known_devices.json");
        let trust_list = TrustList::load(&trust_list_path)?;
        let instance = Self {
            identity: Arc::new(identity),
            peers: Arc::new(RwLock::new(Vec::new())),
            discovery_open: Arc::new(AtomicBool::new(false)),
            data_dir,
            trust_list: Arc::new(RwLock::new(trust_list)),
            db: Arc::new(OnceLock::new()),
            cas: Arc::new(OnceLock::new()),
        };
        // Populate process-globals so the bare `extern "C"` callbacks can reach
        // the peer list and trust list. `.set()` is a no-op if already set,
        // which is fine — there is only one bridge instance per process.
        PEER_LIST.set(Arc::clone(&instance.peers)).ok();
        TRUST_LIST.set(Arc::clone(&instance.trust_list)).ok();
        Ok(instance)
    }

    pub fn set_storage(&self, db: Arc<Database>, cas: Arc<CasStore>) {
        self.db.set(db).ok();
        self.cas.set(cas).ok();
    }
}

impl SyncBridge for IosSyncBridge {
    fn start_discovery(&self) -> Result<(), SyncError> {
        unsafe {
            melo_sync_start_discovery(on_peer_discovered, on_peer_lost);
        }
        Ok(())
    }

    fn stop_discovery(&self) -> Result<(), SyncError> {
        unsafe {
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
        let exp = unix_now() + 60;

        Ok(QrPayload {
            public_key_b64: self.identity.public_key_b64(),
            display_name: self.identity.display_name.clone(),
            addr: None,
            token,
            exp,
        })
    }

    fn accept_qr_pairing(&self, payload: QrPayload) -> Result<(), SyncError> {
        if unix_now() > payload.exp {
            return Err(SyncError::AuthFailed);
        }

        let device = KnownDevice {
            public_key_b64: payload.public_key_b64,
            display_name: payload.display_name,
            added_at: unix_now(),
        };

        let mut list = self
            .trust_list
            .write()
            .map_err(|_| SyncError::IdentityError("trust list lock poisoned".into()))?;
        list.add(device);
        list.save(&self.identity)?;
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

    fn sync_playlist(&self, playlist_id: &str) -> Result<SyncReport, SyncError> {
        let identity = Arc::clone(&self.identity);
        let peers = Arc::clone(&self.peers);
        let db = self.db.get().cloned().ok_or(SyncError::Io(std::io::Error::other("storage not initialised")))?;
        let cas = self.cas.get().cloned().ok_or(SyncError::Io(std::io::Error::other("storage not initialised")))?;
        let playlist_id = playlist_id.to_string();

        tokio::runtime::Handle::current().block_on(async move {
            // 1. Pick best peer.
            let peer = {
                let list = peers.read().map_err(|_| {
                    SyncError::IdentityError("peers lock poisoned".into())
                })?;
                list.first().cloned()
            };
            let peer = peer.ok_or(SyncError::NotPaired)?;

            // 2. Build client.
            let client = SyncClient {
                identity: Arc::clone(&identity),
                http: reqwest::Client::new(),
                base_url: format!("http://{}", peer.addr),
            };

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
                    db.update_branch_head(&playlist_id, local_branch_name, peer_head)
                        .await?;
                    return Ok(SyncReport {
                        blobs_fetched,
                        bytes_fetched,
                        conflicts: vec![],
                    });
                }
                Some(lh) => db.find_common_ancestor(lh, peer_head).await?,
            };

            let local_head_str = local_head.as_deref().expect("checked above");

            // We're ahead — nothing to do.
            if ancestor.as_deref() == Some(peer_head) {
                return Ok(SyncReport {
                    blobs_fetched,
                    bytes_fetched,
                    conflicts: vec![],
                });
            }

            // Fast-forward: our head is the ancestor.
            if ancestor.as_deref() == Some(local_head_str) {
                db.update_branch_head(&playlist_id, local_branch_name, peer_head)
                    .await?;
                return Ok(SyncReport {
                    blobs_fetched,
                    bytes_fetched,
                    conflicts: vec![],
                });
            }

            // True merge.
            let our_tree = db.read_tree_for_commit(&cas, local_head_str).await?;
            let their_tree = db.read_tree_for_commit(&cas, peer_head).await?;

            let base_tree = match &ancestor {
                Some(ancestor_hash) => db.read_tree_for_commit(&cas, ancestor_hash).await?,
                None => TreeBlob::new(""),
            };

            let (conflicts, merged_tree) = diff_trees(&base_tree, &our_tree, &their_tree);

            if !conflicts.is_empty() {
                let pending = PendingMerge {
                    local_head: local_head_str.to_string(),
                    peer_head: peer_head.to_string(),
                    ancestor_hash: ancestor.clone(),
                    branch_name: local_branch_name.to_string(),
                    conflicts: conflicts.clone(),
                };
                // On iOS, conflicts are resolved on desktop instead; call set_pending_merge
                // for symmetry with the desktop implementation (it is a no-op here).
                self.set_pending_merge(&playlist_id, pending);
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
                db.insert_commit(&merge_commit, &[local_head_str, peer_head])
                    .await?;
                db.update_branch_head(&playlist_id, local_branch_name, &merge_commit.hash)
                    .await?;
            }

            Ok(SyncReport {
                blobs_fetched,
                bytes_fetched,
                conflicts: vec![],
            })
        })
    }

    fn sync_with_peer(&self, _public_key_b64: &str) -> Result<SyncReport, SyncError> {
        Ok(SyncReport {
            blobs_fetched: 0,
            bytes_fetched: 0,
            conflicts: vec![],
        })
    }

    fn fingerprint(&self) -> String {
        self.identity.fingerprint()
    }

    fn set_pending_merge(&self, _playlist_id: &str, _merge: PendingMerge) {}
    fn pending_merge(&self, _playlist_id: &str) -> Option<PendingMerge> {
        None
    }
    fn clear_pending_merge(&self, _playlist_id: &str) {}
}
