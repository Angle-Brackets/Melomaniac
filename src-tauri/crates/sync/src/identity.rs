use crate::{KnownDevice, NodeIdentity, SyncError};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{Signer, Verifier, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

// ── NodeIdentity ──────────────────────────────────────────────────────────────

impl NodeIdentity {
    /// Load the node's Ed25519 keypair from the OS keyring, or generate and
    /// store a fresh one if this is the first run.
    ///
    /// The secret key is stored as a base64 string under service `"melomaniac"`,
    /// username `"sync_keypair"`. The display name is read from (or written to)
    /// `{app_data_dir}/sync_name.txt`.
    pub fn load_or_create(app_data_dir: &Path) -> Result<Self, SyncError> {
        let entry = keyring::Entry::new("melomaniac", "sync_keypair")
            .map_err(|e| SyncError::IdentityError(e.to_string()))?;

        let signing_key = match entry.get_password() {
            Ok(b64) => {
                // Existing keypair found in keyring.
                let bytes = B64.decode(b64.trim())
                    .map_err(|e| SyncError::IdentityError(format!("base64 decode: {e}")))?;
                let bytes32: [u8; 32] = bytes
                    .try_into()
                    .map_err(|_| SyncError::IdentityError("keypair wrong length in keyring".into()))?;
                SigningKey::from_bytes(&bytes32)
            }
            Err(keyring::Error::NoEntry) => {
                // First run — generate a fresh keypair and persist it.
                let key = SigningKey::generate(&mut OsRng);
                let b64 = B64.encode(key.to_bytes());
                entry
                    .set_password(&b64)
                    .map_err(|e| SyncError::IdentityError(format!("keyring write: {e}")))?;
                key
            }
            Err(e) => {
                return Err(SyncError::IdentityError(format!("keyring read: {e}")));
            }
        };

        let public_key = signing_key.verifying_key();
        let display_name = Self::read_or_init_display_name(app_data_dir)?;

        Ok(Self {
            public_key,
            secret_key: signing_key,
            display_name,
        })
    }

    /// Read the display name from `{app_data_dir}/sync_name.txt`, creating the
    /// file with a default name if it does not exist.
    pub fn display_name(app_data_dir: &Path) -> Result<String, SyncError> {
        Self::read_or_init_display_name(app_data_dir)
    }

    fn read_or_init_display_name(app_data_dir: &Path) -> Result<String, SyncError> {
        let path = app_data_dir.join("sync_name.txt");
        if path.exists() {
            let name = std::fs::read_to_string(&path)
                .map_err(|e| SyncError::IdentityError(format!("read sync_name.txt: {e}")))?;
            let name = name.trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }

        // Default: system hostname via gethostname(2), or env vars, or "Melomaniac".
        let default_name = Self::system_hostname();
        std::fs::write(&path, &default_name)
            .map_err(|e| SyncError::IdentityError(format!("write sync_name.txt: {e}")))?;
        Ok(default_name)
    }

    fn system_hostname() -> String {
        // gethostname(2) is available on all our platforms (macOS, Linux, iOS).
        #[cfg(unix)]
        {
            let mut buf = [0u8; 256];
            let ret = unsafe {
                libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len())
            };
            if ret == 0 {
                let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                if let Ok(s) = std::str::from_utf8(&buf[..end]) {
                    let s = s.trim().trim_end_matches(".local").to_string();
                    if !s.is_empty() {
                        return s;
                    }
                }
            }
        }
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Melomaniac".into())
    }

    /// Base64-encoded 32-byte Ed25519 verifying (public) key.
    pub fn public_key_b64(&self) -> String {
        B64.encode(self.public_key.as_bytes())
    }

    /// Short fingerprint of the public key for display in UI.
    ///
    /// Returns the first 6 bytes of the public key encoded as uppercase hex,
    /// grouped into three 4-character segments separated by `·` (U+00B7 MIDDLE DOT).
    /// Example: `"AB12·CD34·EF56"`.
    pub fn fingerprint(&self) -> String {
        let bytes = &self.public_key.as_bytes()[..6];
        format!(
            "{:02X}{:02X}·{:02X}{:02X}·{:02X}{:02X}",
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
        )
    }

    /// Sign `msg` with this node's secret key. Returns the raw signature bytes.
    pub fn sign(&self, msg: &[u8]) -> Vec<u8> {
        self.secret_key.sign(msg).to_bytes().to_vec()
    }

    /// Verify a signature produced by the node identified by `public_key_b64`.
    ///
    /// Returns `false` on any error (malformed key, malformed signature, or
    /// signature mismatch) — callers must treat `false` as an authentication
    /// failure.
    pub fn verify(public_key_b64: &str, msg: &[u8], sig: &[u8]) -> bool {
        let Ok(key_bytes) = B64.decode(public_key_b64.trim()) else {
            return false;
        };
        let Ok(key_bytes32) = <[u8; 32]>::try_from(key_bytes.as_slice()) else {
            return false;
        };
        let Ok(verifying_key) = VerifyingKey::from_bytes(&key_bytes32) else {
            return false;
        };
        let Ok(sig_bytes64) = <[u8; 64]>::try_from(sig) else {
            return false;
        };
        let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes64);
        verifying_key.verify(msg, &signature).is_ok()
    }
}

// ── TrustList ─────────────────────────────────────────────────────────────────

/// The local trust list — the set of devices this node considers paired.
///
/// Persisted as `{app_data_dir}/known_devices.json` (pretty-printed JSON).
/// A companion signature file `known_devices.json.sig` is written on every
/// save so callers can detect tampered files.
#[derive(Clone)]
pub struct TrustList {
    devices: Vec<KnownDevice>,
    path: std::path::PathBuf,
}

impl TrustList {
    /// Load the trust list from `path`.
    ///
    /// If the file does not exist, returns an empty list (not an error). If the
    /// file exists but cannot be parsed, returns an error.
    pub fn load(path: &Path) -> Result<Self, SyncError> {
        if !path.exists() {
            return Ok(Self {
                devices: Vec::new(),
                path: path.to_path_buf(),
            });
        }

        let json = std::fs::read_to_string(path)
            .map_err(|e| SyncError::IdentityError(format!("read known_devices.json: {e}")))?;
        let devices: Vec<KnownDevice> = serde_json::from_str(&json)
            .map_err(|e| SyncError::IdentityError(format!("parse known_devices.json: {e}")))?;

        Ok(Self {
            devices,
            path: path.to_path_buf(),
        })
    }

    /// Save the trust list to the path it was loaded from.
    ///
    /// Also writes a `{path}.sig` file containing the base64 signature of the
    /// JSON bytes (signed with `identity`) for tamper detection.
    pub fn save(&self, identity: &NodeIdentity) -> Result<(), SyncError> {
        let json = serde_json::to_string_pretty(&self.devices)
            .map_err(|e| SyncError::IdentityError(format!("serialise known_devices: {e}")))?;

        std::fs::write(&self.path, &json)
            .map_err(|e| SyncError::IdentityError(format!("write known_devices.json: {e}")))?;

        // Write companion signature.
        let sig = identity.sign(json.as_bytes());
        let sig_b64 = B64.encode(&sig);
        let sig_path = self.path.with_extension("json.sig");
        std::fs::write(&sig_path, &sig_b64)
            .map_err(|e| SyncError::IdentityError(format!("write known_devices.json.sig: {e}")))?;

        Ok(())
    }

    /// Returns `true` if `public_key_b64` is in the trust list.
    pub fn is_known(&self, public_key_b64: &str) -> bool {
        self.devices
            .iter()
            .any(|d| d.public_key_b64 == public_key_b64)
    }

    /// Add a device to the trust list. Does not persist; call [`save`](Self::save) afterwards.
    pub fn add(&mut self, device: KnownDevice) {
        // Avoid duplicates — update display name if key already exists.
        if let Some(existing) = self
            .devices
            .iter_mut()
            .find(|d| d.public_key_b64 == device.public_key_b64)
        {
            existing.display_name = device.display_name;
            return;
        }
        self.devices.push(device);
    }

    /// Remove the device with the given public key from the trust list.
    /// Does not persist; call [`save`](Self::save) afterwards.
    pub fn remove(&mut self, public_key_b64: &str) {
        self.devices
            .retain(|d| d.public_key_b64 != public_key_b64);
    }

    /// Rename a device in the trust list. Returns `false` if the key is not found.
    /// Does not persist; call [`save`](Self::save) afterwards.
    pub fn rename(&mut self, public_key_b64: &str, new_name: String) -> bool {
        if let Some(device) = self.devices.iter_mut().find(|d| d.public_key_b64 == public_key_b64) {
            device.display_name = new_name;
            true
        } else {
            false
        }
    }

    /// Returns a clone of all known devices.
    pub fn devices(&self) -> Vec<KnownDevice> {
        self.devices.clone()
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns the current Unix timestamp in seconds.
#[allow(dead_code)]
pub(crate) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod identity_tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as B64;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    fn test_identity() -> NodeIdentity {
        let secret_key = SigningKey::generate(&mut OsRng);
        let public_key = secret_key.verifying_key();
        NodeIdentity {
            public_key,
            secret_key,
            display_name: "TestNode".into(),
        }
    }

    fn known_device(identity: &NodeIdentity) -> KnownDevice {
        KnownDevice {
            public_key_b64: identity.public_key_b64(),
            display_name: identity.display_name.clone(),
            added_at: 0,
        }
    }

    // ── NodeIdentity ──────────────────────────────────────────────────────────

    #[test]
    fn public_key_b64_is_44_chars() {
        let id = test_identity();
        assert_eq!(id.public_key_b64().len(), 44);
    }

    #[test]
    fn public_key_b64_roundtrips() {
        let id = test_identity();
        let b64 = id.public_key_b64();
        let decoded = B64.decode(&b64).expect("b64 must be valid");
        let re_encoded = B64.encode(&decoded);
        assert_eq!(b64, re_encoded);
    }

    #[test]
    fn fingerprint_format() {
        let id = test_identity();
        let fp = id.fingerprint();
        let parts: Vec<&str> = fp.split('·').collect();
        assert_eq!(parts.len(), 3, "fingerprint must have three ·-separated parts");
        for part in &parts {
            assert_eq!(part.len(), 4, "each part must be 4 hex chars");
            assert!(
                part.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_lowercase()),
                "each part must be uppercase hex"
            );
        }
    }

    #[test]
    fn fingerprint_uses_first_6_bytes() {
        let id = test_identity();
        let bytes = id.public_key.as_bytes();
        let expected = format!(
            "{:02X}{:02X}·{:02X}{:02X}·{:02X}{:02X}",
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
        );
        assert_eq!(id.fingerprint(), expected);
    }

    #[test]
    fn sign_and_verify_roundtrip() {
        let id = test_identity();
        let msg = b"hello melomaniac";
        let sig = id.sign(msg);
        assert!(NodeIdentity::verify(&id.public_key_b64(), msg, &sig));
    }

    #[test]
    fn verify_rejects_wrong_signature() {
        let id = test_identity();
        let msg = b"hello melomaniac";
        let mut sig = id.sign(msg);
        sig[0] ^= 0xFF;
        assert!(!NodeIdentity::verify(&id.public_key_b64(), msg, &sig));
    }

    #[test]
    fn verify_rejects_wrong_message() {
        let id = test_identity();
        let sig = id.sign(b"hello");
        assert!(!NodeIdentity::verify(&id.public_key_b64(), b"world", &sig));
    }

    #[test]
    fn verify_rejects_bad_b64() {
        let id = test_identity();
        let sig = id.sign(b"hello");
        assert!(!NodeIdentity::verify("not-valid-base64!!!", b"hello", &sig));
    }

    #[test]
    fn verify_rejects_wrong_key() {
        let id_a = test_identity();
        let id_b = test_identity();
        let sig = id_a.sign(b"hello");
        assert!(!NodeIdentity::verify(&id_b.public_key_b64(), b"hello", &sig));
    }

    #[test]
    fn different_identities_have_different_keys() {
        let id_a = test_identity();
        let id_b = test_identity();
        assert_ne!(id_a.public_key_b64(), id_b.public_key_b64());
    }

    // ── TrustList ─────────────────────────────────────────────────────────────

    #[test]
    fn load_from_nonexistent_path_returns_empty() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let tl = TrustList::load(&path).expect("load must not error on missing file");
        assert!(tl.devices().is_empty());
    }

    #[test]
    fn add_and_is_known() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let mut tl = TrustList::load(&path).expect("load");
        let id = test_identity();
        tl.add(known_device(&id));
        assert!(tl.is_known(&id.public_key_b64()));
    }

    #[test]
    fn is_known_false_for_missing_key() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let tl = TrustList::load(&path).expect("load");
        let id = test_identity();
        assert!(!tl.is_known(&id.public_key_b64()));
    }

    #[test]
    fn add_deduplicates_by_key() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let mut tl = TrustList::load(&path).expect("load");
        let id = test_identity();

        tl.add(KnownDevice {
            public_key_b64: id.public_key_b64(),
            display_name: "First".into(),
            added_at: 0,
        });
        tl.add(KnownDevice {
            public_key_b64: id.public_key_b64(),
            display_name: "Second".into(),
            added_at: 0,
        });

        let devices = tl.devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].display_name, "Second");
    }

    #[test]
    fn remove_works() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let mut tl = TrustList::load(&path).expect("load");
        let id = test_identity();
        tl.add(known_device(&id));
        tl.remove(&id.public_key_b64());
        assert!(!tl.is_known(&id.public_key_b64()));
    }

    #[test]
    fn remove_nonexistent_is_silent() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let mut tl = TrustList::load(&path).expect("load");
        let id = test_identity();
        tl.remove(&id.public_key_b64()); // must not panic
    }

    #[test]
    fn save_and_reload() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let signer = test_identity();

        let id_a = test_identity();
        let id_b = test_identity();

        let mut tl = TrustList::load(&path).expect("load");
        tl.add(known_device(&id_a));
        tl.add(known_device(&id_b));
        tl.save(&signer).expect("save");

        let tl2 = TrustList::load(&path).expect("reload");
        let devices = tl2.devices();
        assert_eq!(devices.len(), 2);
        assert!(tl2.is_known(&id_a.public_key_b64()));
        assert!(tl2.is_known(&id_b.public_key_b64()));
    }

    #[test]
    fn save_writes_sig_file() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let signer = test_identity();

        let mut tl = TrustList::load(&path).expect("load");
        tl.add(known_device(&test_identity()));
        tl.save(&signer).expect("save");

        let sig_path = path.with_extension("json.sig");
        assert!(sig_path.exists(), ".sig file must exist after save");
        let sig_bytes = std::fs::read(&sig_path).expect("read .sig file");
        assert!(!sig_bytes.is_empty(), ".sig file must not be empty");
    }

    #[test]
    fn sig_file_is_valid_signature() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let signer = test_identity();

        let mut tl = TrustList::load(&path).expect("load");
        tl.add(known_device(&test_identity()));
        tl.save(&signer).expect("save");

        let json_bytes = std::fs::read(&path).expect("read json file");
        let sig_b64 = std::fs::read_to_string(path.with_extension("json.sig"))
            .expect("read .sig file");
        let sig = B64.decode(sig_b64.trim()).expect("decode sig b64");

        assert!(NodeIdentity::verify(&signer.public_key_b64(), &json_bytes, &sig));
    }

    #[test]
    fn devices_returns_clone() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let path = dir.path().join("known_devices.json");
        let mut tl = TrustList::load(&path).expect("load");
        let id = test_identity();
        tl.add(known_device(&id));

        let mut snapshot = tl.devices();
        snapshot.clear();

        assert_eq!(
            tl.devices().len(),
            1,
            "original must be unaffected by mutation of the returned clone"
        );
    }
}
