/// Fetch a remote image URL and return its bytes.
/// Called by the artwork editor when the user drops a web image.
/// Runs in the Rust backend to bypass browser CORS restrictions.
#[tauri::command]
pub async fn fetch_image_url(url: String) -> Result<Vec<u8>, String> {
    // Only allow http/https schemes
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http/https URLs are supported".into());
    }

    let response = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Melomaniac/1.0)")
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if !content_type.starts_with("image/") {
        return Err(format!("URL did not return an image (got {content_type})"));
    }

    response.bytes().await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}
