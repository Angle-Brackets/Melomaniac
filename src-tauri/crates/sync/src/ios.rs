use crate::identity::{TrustList, unix_now};
use crate::{KnownDevice, NodeIdentity, PeerInfo, QrPayload, SyncBridge, SyncError, SyncReport};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use rand::RngCore;
use rand::rngs::OsRng;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ── Swift FFI ─────────────────────────────────────────────────────────────────

extern "C" {
    fn melo_sync_start_discovery(
        on_discovered: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
        on_lost: extern "C" fn(*const std::ffi::c_char),
    );
    fn melo_sync_stop_discovery();
}

// Stub callbacks — the real peer-update loop will be wired by a subsequent agent.
extern "C" fn on_peer_discovered(
    _public_key: *const std::ffi::c_char,
    _addr: *const std::ffi::c_char,
) {
}

extern "C" fn on_peer_lost(_public_key: *const std::ffi::c_char) {}

// ── IosSyncBridge ─────────────────────────────────────────────────────────────

pub struct IosSyncBridge {
    identity: Arc<NodeIdentity>,
    peers: Arc<RwLock<Vec<PeerInfo>>>,
    discovery_open: Arc<AtomicBool>,
    data_dir: PathBuf,
    trust_list: Arc<RwLock<TrustList>>,
}

impl IosSyncBridge {
    pub fn new(identity: NodeIdentity, data_dir: PathBuf) -> Result<Self, SyncError> {
        let trust_list_path = data_dir.join("known_devices.json");
        let trust_list = TrustList::load(&trust_list_path)?;
        Ok(Self {
            identity: Arc::new(identity),
            peers: Arc::new(RwLock::new(Vec::new())),
            discovery_open: Arc::new(AtomicBool::new(false)),
            data_dir,
            trust_list: Arc::new(RwLock::new(trust_list)),
        })
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

    fn sync_playlist(&self, _playlist_id: &str) -> Result<SyncReport, SyncError> {
        Ok(SyncReport {
            blobs_fetched: 0,
            bytes_fetched: 0,
            conflicts: vec![],
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
}
