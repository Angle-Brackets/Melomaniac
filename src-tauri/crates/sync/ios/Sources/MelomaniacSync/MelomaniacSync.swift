import Foundation
import Network
#if canImport(UIKit)
import UIKit
#endif

// ── Callback type aliases ─────────────────────────────────────────────────────
//
// @convention(c) function pointers are plain values (memory addresses of
// static extern "C" fn declarations in Rust). They are safe to capture in
// closures and use across threads.

/// Called when a peer is discovered or updated.
/// Arguments: public_key (null-terminated UTF-8), addr (null-terminated "ip:port").
public typealias MeloPeerDiscoveredCallback = @convention(c) (
    UnsafePointer<CChar>,   // public_key_b64
    UnsafePointer<CChar>    // addr "ip:port"
) -> Void

/// Called when a peer disappears from the local network.
/// Argument: public_key (null-terminated UTF-8).
public typealias MeloPeerLostCallback = @convention(c) (
    UnsafePointer<CChar>    // public_key_b64
) -> Void

/// Called when network reachability changes.
/// Argument: 1 if the network is available, 0 if not.
public typealias MeloNetworkChangeCallback = @convention(c) (Int32) -> Void

// ── Module-level state ────────────────────────────────────────────────────────

private var _browser:  NWBrowser?  = nil
private var _listener: NWListener?  = nil
private let _mdnsQueue = DispatchQueue(label: "melo.sync.mdns", qos: .utility)

// Default port used when the service endpoint does not carry a port number.
private let _defaultPort: UInt16 = 7700

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Invoke `body` with a C-string pointer valid only for the duration of the call.
private func withCString(_ s: String, _ body: (UnsafePointer<CChar>) -> Void) {
    s.withCString(body)
}

/// Extract the `pk` key from an `NWTXTRecord`, returning nil when absent.
private func extractPK(from txt: NWTXTRecord) -> String? {
    guard let value = txt.dictionary["pk"], !value.isEmpty else { return nil }
    return value
}

/// Parse the remote endpoint of a ready connection into an "ip:port" string.
private func endpointAddress(from endpoint: NWEndpoint?, fallbackPort: UInt16) -> String? {
    guard let endpoint = endpoint else { return nil }
    switch endpoint {
    case .hostPort(let host, let port):
        let portValue = port.rawValue != 0 ? port.rawValue : fallbackPort
        switch host {
        case .ipv4(let v4):
            return "\(v4):\(portValue)"
        case .ipv6(let v6):
            return "[\(v6)]:\(portValue)"
        case .name(let name, _):
            return "\(name):\(portValue)"
        @unknown default:
            return nil
        }
    default:
        return nil
    }
}

/// Extract the port advertised by a Bonjour service endpoint, defaulting to
/// `_defaultPort` when not available.
private func servicePort(from endpoint: NWEndpoint) -> UInt16 {
    if case .service(_, _, _, _) = endpoint {
        // Port is resolved only after NWConnection becomes ready;
        // callers should prefer conn.currentPath?.remoteEndpoint.
        return _defaultPort
    }
    if case .hostPort(_, let port) = endpoint {
        return port.rawValue != 0 ? port.rawValue : _defaultPort
    }
    return _defaultPort
}

// ── melo_sync_start_discovery ─────────────────────────────────────────────────

/// Start mDNS/Bonjour-based peer discovery.
/// `onDiscovered` is invoked (from the mDNS queue) each time a peer announces
/// itself; `onLost` is invoked when a peer disappears.
@_cdecl("melo_sync_start_discovery")
public func meloSyncStartDiscovery(
    _ onDiscovered: MeloPeerDiscoveredCallback,
    _ onLost:       MeloPeerLostCallback
) {
    // Cancel any existing browser before starting a new one.
    _browser?.cancel()
    _browser = nil

    let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(
        type: "_melomaniac._tcp",
        domain: "local."
    )
    let parameters = NWParameters()
    parameters.includePeerToPeer = true

    let browser = NWBrowser(for: descriptor, using: parameters)

    browser.stateUpdateHandler = { state in
        switch state {
        case .failed(let error):
            fputs("[MeloSync] NWBrowser failed: \(error)\n", stderr)
        case .cancelled:
            fputs("[MeloSync] NWBrowser cancelled\n", stderr)
        case .ready:
            fputs("[MeloSync] NWBrowser ready\n", stderr)
        default:
            break
        }
    }

    browser.browseResultsChangedHandler = { results, changes in
        for change in changes {
            switch change {
            case .added(let result):
                handleAdded(result: result, onDiscovered: onDiscovered)
            case .removed(let result):
                handleRemoved(result: result, onLost: onLost)
            case .changed(_, let newResult, _):
                // Treat a metadata change as remove-then-add.
                handleRemoved(result: newResult, onLost: onLost)
                handleAdded(result: newResult, onDiscovered: onDiscovered)
            case .identical:
                break
            @unknown default:
                break
            }
        }
    }

    browser.start(queue: _mdnsQueue)
    _browser = browser
}

// ── Result handlers ───────────────────────────────────────────────────────────

private func handleAdded(
    result: NWBrowser.Result,
    onDiscovered: MeloPeerDiscoveredCallback
) {
    guard
        case .bonjour(let txt) = result.metadata,
        let pk = extractPK(from: txt),
        !pk.isEmpty
    else {
        fputs("[MeloSync] added result missing pk TXT key — skipping\n", stderr)
        return
    }

    // Read the pre-resolved "ip:port" string the desktop embeds in the TXT
    // record.  This avoids an NWConnection round-trip whose remoteEndpoint can
    // resolve to a .name (hostname) string that Rust's SocketAddr::parse
    // cannot handle.
    if let addr = txt.dictionary["addr"], !addr.isEmpty {
        fputs("[MeloSync] peer discovered via TXT addr: pk=\(pk.prefix(8))… addr=\(addr)\n", stderr)
        withCString(pk)   { pkPtr  in
        withCString(addr) { addrPtr in
            onDiscovered(pkPtr, addrPtr)
        }}
        return
    }

    // Fallback: open a connection to let NWFramework resolve the IP.
    let advertisedPort = servicePort(from: result.endpoint)
    let params = NWParameters.tcp
    let conn = NWConnection(to: result.endpoint, using: params)

    conn.stateUpdateHandler = { [conn] state in
        switch state {
        case .ready:
            let remote = conn.currentPath?.remoteEndpoint
            // Only accept a resolved hostPort — .name endpoints produce hostname
            // strings that Rust's SocketAddr::parse rejects.
            if case .hostPort(let host, let port) = remote {
                let portVal = port.rawValue != 0 ? port.rawValue : advertisedPort
                let addrStr: String
                switch host {
                case .ipv4(let v4): addrStr = "\(v4):\(portVal)"
                case .ipv6(let v6): addrStr = "[\(v6)]:\(portVal)"
                default:
                    fputs("[MeloSync] remote endpoint resolved to hostname — skipping peer \(pk.prefix(8))…\n", stderr)
                    conn.cancel()
                    return
                }
                fputs("[MeloSync] peer discovered via NWConnection: pk=\(pk.prefix(8))… addr=\(addrStr)\n", stderr)
                withCString(pk)      { pkPtr  in
                withCString(addrStr) { addrPtr in
                    onDiscovered(pkPtr, addrPtr)
                }}
            } else {
                fputs("[MeloSync] remote endpoint not hostPort for peer \(pk.prefix(8))… — skipping\n", stderr)
            }
            conn.cancel()

        case .failed(let error):
            fputs("[MeloSync] resolution connection failed for peer \(pk.prefix(8))…: \(error)\n", stderr)
            conn.cancel()

        case .cancelled:
            break

        default:
            break
        }
    }

    conn.start(queue: _mdnsQueue)
}

private func handleRemoved(
    result: NWBrowser.Result,
    onLost: MeloPeerLostCallback
) {
    guard
        case .bonjour(let txt) = result.metadata,
        let pk = extractPK(from: txt),
        !pk.isEmpty
    else {
        fputs("[MeloSync] removed result missing pk TXT key — skipping\n", stderr)
        return
    }

    withCString(pk) { pkPtr in
        onLost(pkPtr)
    }
}

// ── melo_sync_stop_discovery ──────────────────────────────────────────────────

/// Stop the running peer discovery browser and release associated resources.
@_cdecl("melo_sync_stop_discovery")
public func meloSyncStopDiscovery() {
    _browser?.cancel()
    _browser = nil
}

// ── melo_sync_register_service ────────────────────────────────────────────────

/// Advertise this device as a Melomaniac node on the local network.
/// Must be called after melo_sync_start_discovery so other devices can find us.
@_cdecl("melo_sync_register_service")
public func meloSyncRegisterService(
    _ pk:   UnsafePointer<CChar>,
    _ name: UnsafePointer<CChar>,
    _ port: UInt16
) {
    _listener?.cancel()
    _listener = nil

    let pkStr   = String(cString: pk)
    let nameStr = String(cString: name)
    let txt     = NWTXTRecord(["v": "1", "pk": pkStr, "name": nameStr, "mode": "closed"])

    let params = NWParameters.tcp
    params.includePeerToPeer = true

    guard let listener = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: port) ?? 7700) else {
        fputs("[MeloSync] NWListener init failed\n", stderr)
        return
    }
    listener.service = NWListener.Service(
        name: nameStr,
        type: "_melomaniac._tcp",
        domain: "local.",
        txtRecord: txt
    )
    listener.stateUpdateHandler = { state in
        switch state {
        case .ready:   fputs("[MeloSync] NWListener ready on port \(port)\n", stderr)
        case .failed(let e): fputs("[MeloSync] NWListener failed: \(e)\n", stderr)
        default: break
        }
    }
    // Reject all incoming connections — we only need the advertisement.
    listener.newConnectionHandler = { conn in conn.cancel() }
    listener.start(queue: _mdnsQueue)
    _listener = listener
}

/// Stop advertising this device on the local network.
@_cdecl("melo_sync_unregister_service")
public func meloSyncUnregisterService() {
    _listener?.cancel()
    _listener = nil
}

// ── melo_get_device_name ──────────────────────────────────────────────────────

/// Copy the human-readable device name into `buf` (max `len` bytes, null-terminated).
/// On iOS this is UIDevice.current.name ("Ankit's iPhone"); on other Apple
/// platforms it falls back to the Bonjour hostname.
@_cdecl("melo_get_device_name")
public func meloGetDeviceName(
    _ buf: UnsafeMutablePointer<CChar>,
    _ len: Int
) {
    #if canImport(UIKit)
    let name = UIDevice.current.name
    #else
    let name = Host.current().localizedName ?? "Melomaniac"
    #endif
    let utf8 = Array(name.utf8CString)
    let count = min(utf8.count, len)
    for i in 0..<count {
        buf[i] = utf8[i]
    }
    buf[count - 1] = 0  // ensure null termination
}

// ── melo_sync_register_network_change ────────────────────────────────────────

/// Register a callback that fires whenever the device's network path changes
/// (e.g. Wi-Fi gained/lost, cellular handoff). The callback receives 1 if a
/// usable path is available, 0 otherwise.
///
/// Phase 2: NWPathMonitor integration. Left as a stub — iOS re-triggers
/// NWBrowser browse results automatically on path changes when the browser
/// is active.
@_cdecl("melo_sync_register_network_change")
public func meloSyncRegisterNetworkChange(_ callback: MeloNetworkChangeCallback) {
    // Phase 2 — intentionally empty.
}
