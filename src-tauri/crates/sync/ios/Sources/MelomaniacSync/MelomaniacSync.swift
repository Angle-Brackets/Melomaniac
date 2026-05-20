import Foundation
import Network

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

private var _browser: NWBrowser? = nil
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
    var result: String? = nil
    txt.apply { key, _, value in
        guard key == "pk", result == nil else { return }
        if let data = value, !data.isEmpty {
            result = String(bytes: data, encoding: .utf8)
        }
    }
    return result
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
    // Extract TXT-record pk immediately — it is available without a connection.
    guard
        case .bonjour(let txt) = result.metadata,
        let pk = extractPK(from: txt),
        !pk.isEmpty
    else {
        fputs("[MeloSync] added result missing pk TXT key — skipping\n", stderr)
        return
    }

    // Determine the advertised port from the service endpoint (best-effort).
    let advertisedPort = servicePort(from: result.endpoint)

    // Open an NWConnection to resolve the IP address.
    let params = NWParameters.tcp
    let conn = NWConnection(to: result.endpoint, using: params)

    conn.stateUpdateHandler = { [conn] state in
        switch state {
        case .ready:
            let remote = conn.currentPath?.remoteEndpoint
            let addr = endpointAddress(from: remote, fallbackPort: advertisedPort)
                    ?? endpointAddress(from: result.endpoint, fallbackPort: advertisedPort)

            if let addr = addr {
                withCString(pk)   { pkPtr  in
                withCString(addr) { addrPtr in
                    onDiscovered(pkPtr, addrPtr)
                }}
            } else {
                fputs("[MeloSync] could not resolve address for peer \(pk)\n", stderr)
            }
            // We only needed the address; cancel the connection immediately.
            conn.cancel()

        case .failed(let error):
            fputs("[MeloSync] resolution connection failed for peer \(pk): \(error)\n", stderr)
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
