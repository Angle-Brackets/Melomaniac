use std::io::{Read, Write};
use std::net::TcpListener;

/// Blocks until a single HTTP GET request arrives on `listener` (the
/// provider's OAuth redirect), replies with a minimal "you can close this
/// window" page, and returns the request's raw query string. Shared by
/// desktop (system browser) and iOS (loopback caught alongside an
/// `ASWebAuthenticationSession` sheet, since Spotify's redirect URI rules no
/// longer accept custom URL schemes).
pub(crate) fn accept_and_parse(listener: TcpListener) -> Result<String, String> {
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
}
