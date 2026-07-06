use crate::OAuthBridge;
use std::io::{Read, Write};
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
            let result = (|| -> Result<String, String> {
                let (mut stream, _) = listener
                    .accept()
                    .map_err(|e| format!("callback listener accept failed: {e}"))?;

                let mut buf = [0u8; 8192];
                let n = stream
                    .read(&mut buf)
                    .map_err(|e| format!("failed to read callback request: {e}"))?;
                let request = String::from_utf8_lossy(&buf[..n]);

                // Request line looks like: "GET /callback?code=...&state=... HTTP/1.1"
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");
                let query = path
                    .split_once('?')
                    .map(|(_, q)| q.to_string())
                    .ok_or_else(|| "malformed callback request".to_string())?;

                let body = "<html><body><h2>You can close this window.</h2></body></html>";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());

                Ok(query)
            })();
            let _ = tx.send(result);
        });

        rx.recv_timeout(Duration::from_secs(120))
            .map_err(|_| "timed out waiting for authorization".to_string())?
    }
}
