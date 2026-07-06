use crate::OAuthBridge;
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

const REDIRECT_PORT: u16 = 17342;
const REDIRECT_URI: &str = "http://127.0.0.1:17342/callback";

pub struct DesktopOAuthBridge;

impl DesktopOAuthBridge {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DesktopOAuthBridge {
    fn default() -> Self {
        Self::new()
    }
}

impl OAuthBridge for DesktopOAuthBridge {
    fn redirect_uri(&self) -> &str {
        REDIRECT_URI
    }

    fn authenticate(&self, auth_url: &str) -> Result<String, String> {
        open::that(auth_url).map_err(|e| format!("failed to open browser: {e}"))?;

        let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
            .map_err(|e| format!("failed to bind loopback callback listener: {e}"))?;

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(crate::loopback::accept_and_parse(listener));
        });

        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "timed out waiting for authorization".to_string())?
    }
}
