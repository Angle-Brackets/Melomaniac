use crate::OAuthBridge;
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::Duration;

const REDIRECT_PORT: u16 = 17343;
const REDIRECT_URI: &str = "http://127.0.0.1:17343/callback";

// `ASWebAuthenticationSession` requires a callback URL scheme, but Spotify's
// 2025 redirect URI security rules no longer accept custom schemes as a
// redirect_uri — only HTTPS or a loopback address. So the real redirect goes
// to the loopback TCP listener in `authenticate` below, exactly like desktop;
// this placeholder scheme is never expected to actually appear in a
// navigated URL. It only lets the session's completion handler report the
// user manually cancelling the sheet.
const PLACEHOLDER_SCHEME: &str = "melomaniac";

unsafe extern "C" {
    fn melo_oauth_authenticate(
        url: *const std::ffi::c_char,
        scheme: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char, *const std::ffi::c_char),
    );
    fn melo_oauth_dismiss();
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

// Fires only when the user cancels/dismisses the sheet manually (or, in the
// unlikely case the placeholder scheme is somehow matched, with a URL) — the
// success path is driven independently by the loopback listener spawned in
// `authenticate`, whichever resolves first wins the race.
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
        let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
            .map_err(|e| format!("failed to bind loopback callback listener: {e}"))?;

        let (tx, rx) = mpsc::channel();
        PENDING.get_or_init(|| Mutex::new(None));
        *PENDING.get().unwrap().lock().unwrap() = Some(tx.clone());

        let listener_tx = tx.clone();
        std::thread::spawn(move || {
            let _ = listener_tx.send(crate::loopback::accept_and_parse(listener));
        });

        let url_c = std::ffi::CString::new(auth_url).map_err(|e| e.to_string())?;
        let scheme_c = std::ffi::CString::new(PLACEHOLDER_SCHEME).unwrap();
        unsafe { melo_oauth_authenticate(url_c.as_ptr(), scheme_c.as_ptr(), on_complete) };

        let result = rx
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| "timed out waiting for authorization".to_string())?;

        // Close the sheet once we have an answer, whether it came from the
        // loopback listener (normal success) or the session itself (cancel).
        unsafe { melo_oauth_dismiss() };

        result
    }
}
