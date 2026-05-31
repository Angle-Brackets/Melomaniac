import Foundation
import Network
#if canImport(UIKit)
import UIKit
#endif

// ── Callback type aliases ─────────────────────────────────────────────────────

public typealias MeloPeerDiscoveredCallback = @convention(c) (
    UnsafePointer<CChar>,   // public_key_b64
    UnsafePointer<CChar>    // addr "ip:port"
) -> Void

public typealias MeloPeerLostCallback = @convention(c) (
    UnsafePointer<CChar>    // public_key_b64
) -> Void

public typealias MeloNetworkChangeCallback = @convention(c) (Int32) -> Void

// ── Logging bridge ────────────────────────────────────────────────────────────
//
// Swift's fputs goes to Xcode's device console, not the `tauri ios dev`
// terminal.  Routing through melo_sync_log (Rust #[no_mangle] extern "C")
// makes all NWBrowser/NWListener state visible alongside Rust eprintln! logs.

@_silgen_name("melo_sync_log")
private func _meloSyncLog(_ msg: UnsafePointer<CChar>)

private func meloLog(_ msg: String) {
    msg.withCString { _meloSyncLog($0) }
}

// ── Module-level state ────────────────────────────────────────────────────────

private var _browser:  NWBrowser?  = nil
private var _listener: NWListener?  = nil
private let _mdnsQueue = DispatchQueue(label: "melo.sync.mdns", qos: .utility)

private let _defaultPort: UInt16 = 7700

// ── Helpers ───────────────────────────────────────────────────────────────────

private func withCString(_ s: String, _ body: (UnsafePointer<CChar>) -> Void) {
    s.withCString(body)
}

private func extractPK(from txt: NWTXTRecord) -> String? {
    guard let value = txt.dictionary["pk"], !value.isEmpty else { return nil }
    return value
}

private func servicePort(from endpoint: NWEndpoint) -> UInt16 {
    if case .service(_, _, _, _) = endpoint {
        return _defaultPort
    }
    if case .hostPort(_, let port) = endpoint {
        return port.rawValue != 0 ? port.rawValue : _defaultPort
    }
    return _defaultPort
}

// ── melo_sync_start_discovery ─────────────────────────────────────────────────

@_cdecl("melo_sync_start_discovery")
public func meloSyncStartDiscovery(
    _ onDiscovered: MeloPeerDiscoveredCallback,
    _ onLost:       MeloPeerLostCallback
) {
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
            meloLog("NWBrowser failed: \(error)")
        case .cancelled:
            meloLog("NWBrowser cancelled")
        case .ready:
            meloLog("NWBrowser ready — scanning for _melomaniac._tcp peers")
        case .waiting(let error):
            meloLog("NWBrowser waiting: \(error)")
        default:
            break
        }
    }

    browser.browseResultsChangedHandler = { results, changes in
        meloLog("NWBrowser results changed: \(results.count) total, \(changes.count) change(s)")
        for change in changes {
            switch change {
            case .added(let result):
                handleAdded(result: result, onDiscovered: onDiscovered)
            case .removed(let result):
                handleRemoved(result: result, onLost: onLost)
            case .changed(_, let newResult, _):
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
    meloLog("NWBrowser started for _melomaniac._tcp.local.")
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
        meloLog("added result missing pk TXT key — skipping")
        return
    }

    // Read the pre-resolved "ip:port" the desktop embeds in its TXT record.
    // This avoids an NWConnection whose remoteEndpoint can be a .name (hostname)
    // string that Rust's SocketAddr::parse rejects.
    if let addr = txt.dictionary["addr"], !addr.isEmpty {
        meloLog("peer discovered via TXT addr: pk=\(pk.prefix(8))… addr=\(addr)")
        withCString(pk)   { pkPtr  in
        withCString(addr) { addrPtr in
            onDiscovered(pkPtr, addrPtr)
        }}
        return
    }

    meloLog("peer has no addr TXT key (old desktop build?), trying NWConnection — pk=\(pk.prefix(8))…")

    // Fallback: open a TCP connection so NWFramework resolves the IP.
    let advertisedPort = servicePort(from: result.endpoint)
    let params = NWParameters.tcp
    let conn = NWConnection(to: result.endpoint, using: params)

    conn.stateUpdateHandler = { [conn] state in
        switch state {
        case .ready:
            let remote = conn.currentPath?.remoteEndpoint
            if case .hostPort(let host, let port) = remote {
                let portVal = port.rawValue != 0 ? port.rawValue : advertisedPort
                let addrStr: String
                switch host {
                case .ipv4(let v4): addrStr = "\(v4):\(portVal)"
                case .ipv6(let v6): addrStr = "[\(v6)]:\(portVal)"
                default:
                    meloLog("NWConnection resolved to hostname for pk=\(pk.prefix(8))… — skipping")
                    conn.cancel()
                    return
                }
                meloLog("peer discovered via NWConnection: pk=\(pk.prefix(8))… addr=\(addrStr)")
                withCString(pk)      { pkPtr  in
                withCString(addrStr) { addrPtr in
                    onDiscovered(pkPtr, addrPtr)
                }}
            } else {
                meloLog("NWConnection remoteEndpoint not hostPort for pk=\(pk.prefix(8))… — skipping")
            }
            conn.cancel()

        case .failed(let error):
            meloLog("NWConnection failed for pk=\(pk.prefix(8))…: \(error)")
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
        meloLog("removed result missing pk TXT key — skipping")
        return
    }

    meloLog("peer lost: pk=\(pk.prefix(8))…")
    withCString(pk) { pkPtr in
        onLost(pkPtr)
    }
}

// ── melo_sync_stop_discovery ──────────────────────────────────────────────────

@_cdecl("melo_sync_stop_discovery")
public func meloSyncStopDiscovery() {
    _browser?.cancel()
    _browser = nil
}

// ── melo_sync_register_service ────────────────────────────────────────────────

@_cdecl("melo_sync_register_service")
public func meloSyncRegisterService(
    _ pk:        UnsafePointer<CChar>,
    _ name:      UnsafePointer<CChar>,
    _ port:      UInt16,
    _ addr_hint: UnsafePointer<CChar>
) {
    _listener?.cancel()
    _listener = nil

    let pkStr    = String(cString: pk)
    let nameStr  = String(cString: name)
    let addrStr  = String(cString: addr_hint)

    // Include the addr TXT field so peers can connect directly to the Axum HTTP server.
    var txtDict: [String: String] = ["v": "1", "pk": pkStr, "name": nameStr, "mode": "closed"]
    if !addrStr.isEmpty { txtDict["addr"] = addrStr }
    let txt = NWTXTRecord(txtDict)

    // Use a random port for the NWListener — its only purpose is mDNS advertisement.
    // The actual HTTP server (Axum, on `port`) handles connections.
    let params = NWParameters.tcp
    params.includePeerToPeer = true

    guard let listener = try? NWListener(using: params) else {
        meloLog("NWListener init failed")
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
        case .ready:   meloLog("NWListener ready — advertising '\(nameStr)' addr=\(addrStr)")
        case .failed(let e): meloLog("NWListener failed: \(e)")
        default: break
        }
    }
    // All real HTTP is handled by Axum; reject NWListener connections immediately.
    listener.newConnectionHandler = { conn in conn.cancel() }
    listener.start(queue: _mdnsQueue)
    _listener = listener
}

@_cdecl("melo_sync_unregister_service")
public func meloSyncUnregisterService() {
    _listener?.cancel()
    _listener = nil
}

// ── melo_get_device_name ──────────────────────────────────────────────────────

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
    buf[count - 1] = 0
}

// ── melo_sync_register_network_change ────────────────────────────────────────

@_cdecl("melo_sync_register_network_change")
public func meloSyncRegisterNetworkChange(_ callback: MeloNetworkChangeCallback) {
    // Phase 2 — intentionally empty.
}
