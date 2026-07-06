pub trait OAuthBridge: Send + Sync {
    /// The redirect URI this platform's flow uses — callers must bake this
    /// into the provider's `/authorize` URL and token-exchange request.
    fn redirect_uri(&self) -> &str;

    /// Presents `auth_url` via whatever platform-native flow is appropriate
    /// (a loopback browser redirect on desktop, an `ASWebAuthenticationSession`
    /// sheet on iOS), blocks until the provider redirects back to
    /// [`redirect_uri`](Self::redirect_uri), and returns the callback's raw
    /// query string (e.g. `"code=...&state=..."` or `"error=access_denied&state=..."`).
    /// Callers are responsible for parsing/validating this — provider-specific.
    fn authenticate(&self, auth_url: &str) -> Result<String, String>;
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
pub mod desktop;
#[cfg(target_os = "ios")]
pub mod ios;

// Shared by desktop and iOS — both catch the provider's OAuth redirect via a
// real loopback TCP listener rather than a custom URL scheme (Spotify's 2025
// redirect URI security rules no longer accept custom schemes; loopback
// addresses remain an explicit exception).
#[cfg(any(
    target_os = "macos",
    target_os = "windows",
    target_os = "linux",
    target_os = "ios"
))]
mod loopback;
