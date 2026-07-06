import AuthenticationServices
import UIKit

public typealias MeloOAuthCallback = @convention(c) (
    UnsafePointer<CChar>?,  // callback URL string on success, else nil
    UnsafePointer<CChar>?   // error message on failure/cancel, else nil
) -> Void

@_silgen_name("melo_oauth_log")
private func _meloOAuthLog(_ msg: UnsafePointer<CChar>)
private func meloLog(_ msg: String) { msg.withCString { _meloOAuthLog($0) } }

private final class PresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

// `extern "C" fn` pointers cannot capture state, and the session object must
// stay alive until its completion handler fires — held as a process-global,
// same pattern as NWBrowser/NWListener in MelomaniacSync.swift.
private let presentationProvider = PresentationContextProvider()
private var authSession: ASWebAuthenticationSession?

@_cdecl("melo_oauth_authenticate")
public func meloOAuthAuthenticate(
    _ urlPtr: UnsafePointer<CChar>,
    _ schemePtr: UnsafePointer<CChar>,
    _ callback: @escaping MeloOAuthCallback
) {
    let urlString = String(cString: urlPtr)
    let scheme = String(cString: schemePtr)
    guard let url = URL(string: urlString) else {
        meloLog("melo_oauth_authenticate: invalid auth URL")
        "invalid authorization URL".withCString { callback(nil, $0) }
        return
    }
    DispatchQueue.main.async {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callbackURL, error in
            if let error = error {
                meloLog("melo_oauth_authenticate: \(error.localizedDescription)")
                error.localizedDescription.withCString { callback(nil, $0) }
                return
            }
            guard let callbackURL = callbackURL else {
                "no callback URL".withCString { callback(nil, $0) }
                return
            }
            callbackURL.absoluteString.withCString { callback($0, nil) }
        }
        session.presentationContextProvider = presentationProvider
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
    }
}
