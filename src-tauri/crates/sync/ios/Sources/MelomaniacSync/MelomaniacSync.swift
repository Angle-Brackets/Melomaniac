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

// ── Placeholder — implemented by the iOS sync agent ──────────────────────────

/// Start mDNS/Bonjour-based peer discovery.
/// `onDiscovered` is invoked (from a background queue) each time a peer
/// announces itself; `onLost` is invoked when a peer disappears.
@_cdecl("melo_sync_start_discovery")
public func meloSyncStartDiscovery(
    _ onDiscovered: MeloPeerDiscoveredCallback,
    _ onLost:       MeloPeerLostCallback
) {
    // Placeholder — the iOS agent will implement NWBrowser browsing here.
    NSLog("[MeloSync] start_discovery called (stub)")
}

/// Stop the running peer discovery browser and release associated resources.
@_cdecl("melo_sync_stop_discovery")
public func meloSyncStopDiscovery() {
    // Placeholder — the iOS agent will cancel the NWBrowser here.
    NSLog("[MeloSync] stop_discovery called (stub)")
}

/// Register a callback that fires whenever the device's network path changes
/// (e.g. Wi-Fi gained/lost, cellular handoff). The callback receives 1 if a
/// usable path is available, 0 otherwise.
@_cdecl("melo_sync_register_network_change")
public func meloSyncRegisterNetworkChange(_ callback: MeloNetworkChangeCallback) {
    // Placeholder — the iOS agent will implement NWPathMonitor here.
    NSLog("[MeloSync] register_network_change called (stub)")
}
