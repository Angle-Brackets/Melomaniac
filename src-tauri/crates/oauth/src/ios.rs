use crate::OAuthBridge;
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::Duration;

const REDIRECT_SCHEME: &str = "melomaniac";
const REDIRECT_URI: &str = "melomaniac://oauth-callback";

unsafe extern "C" {
    fn melo_oauth_authenticate(
        url: *const std::ffi::c_char,
        scheme: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
    );
}

/// Called from Swift so `ASWebAuthenticationSession` state messages appear in
/// the same `eprintln!` stream as other Rust logs (Swift's own stderr goes to
/// Xcode's device console, not the `tauri ios dev` terminal).
#[unsafe(no_mangle)]
pub extern "C" fn melo_oauth_log(msg: *const std::ffi::c_char) {
    let s = unsafe { std::ffi::CStr::from_ptr(msg).to_str().unwrap_or("?") };
    eprintln!("[MeloOAuth] {s}");
}

// `extern "C" fn` pointers cannot capture state, and only one auth flow is
// ever in flight, so the pending result channel is shared via a process-global.
static PENDING: OnceLock<Mutex<Option<mpsc::Sender<Result<String, String>>>>> = OnceLock::new();

// Swift hands back the full callback URL (or an error string); this strips
// it down to just the query string so callers get the same shape as
// desktop's `DesktopOAuthBridge`.
extern "C" fn on_complete(url_ptr: *const std::ffi::c_char, err_ptr: *const std::ffi::c_char) {
    let result = if !url_ptr.is_null() {
        let full = unsafe { std::ffi::CStr::from_ptr(url_ptr) }
            .to_str()
            .unwrap_or("")
            .to_string();
        full.split_once('?')
            .map(|(_, q)| q.to_string())
            .ok_or_else(|| "malformed callback URL".to_string())
    } else {
        let err = unsafe { std::ffi::CStr::from_ptr(err_ptr) }
            .to_str()
            .unwrap_or("authentication failed")
            .to_string();
        Err(err)
    };
    if let Some(tx) = PENDING.get().and_then(|m| m.lock().unwrap().take()) {
        let _ = tx.send(result);
    }
}

pub struct IosOAuthBridge;

impl IosOAuthBridge {
    pub fn new() -> Self {
        Self
    }
}

impl Default for IosOAuthBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl OAuthBridge for IosOAuthBridge {
    fn redirect_uri(&self) -> &str {
        REDIRECT_URI
    }

    fn authenticate(&self, auth_url: &str) -> Result<String, String> {
        let (tx, rx) = mpsc::channel();
        PENDING.get_or_init(|| Mutex::new(None));
        *PENDING.get().unwrap().lock().unwrap() = Some(tx);

        let url_c = std::ffi::CString::new(auth_url).map_err(|e| e.to_string())?;
        let scheme_c = std::ffi::CString::new(REDIRECT_SCHEME).unwrap();
        unsafe { melo_oauth_authenticate(url_c.as_ptr(), scheme_c.as_ptr(), on_complete) };

        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "timed out waiting for authorization".to_string())?
    }
}
