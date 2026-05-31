fn main() {
    // `CARGO_CFG_TARGET_OS` is set by Cargo to the *target* platform, which is
    // what we actually want to check. `#[cfg(target_os)]` in contrast reflects
    // the *host* OS and is always "macos" when building on a Mac — it would be
    // true even when building for Linux, so it cannot guard iOS-only code here.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "ios" {
        // `#[cfg(target_os = "macos")]` here is a *host* check: swift-rs only
        // compiles on a macOS host (it shells out to swiftc/swift build), so
        // this crate does not declare swift-rs as a build-dep on other hosts.
        #[cfg(target_os = "macos")]
        compile_swift();
    }
}

// This function exists only when the host is macOS, matching the build-dep
// declaration in Cargo.toml: `[target.'cfg(target_os = "macos")'.build-dependencies]`.
#[cfg(target_os = "macos")]
fn compile_swift() {
    use swift_rs::SwiftLinker;

    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").unwrap();
    let ios_dir = std::path::PathBuf::from(manifest_dir).join("ios");

    // Inherit deployment targets from the environment when set by Tauri/Xcode;
    // fall back to sensible minimums that cover Network framework APIs.
    let macos_min = std::env::var("MACOSX_DEPLOYMENT_TARGET")
        .unwrap_or_else(|_| "10.13".into());
    let ios_min = std::env::var("IPHONEOS_DEPLOYMENT_TARGET")
        .unwrap_or_else(|_| "14.0".into());

    println!("cargo:rerun-if-changed=ios/Package.swift");
    println!("cargo:rerun-if-changed=ios/Sources/MelomaniacSync/MelomaniacSync.swift");

    // Tauri's Xcode build phase sets SDKROOT to the iPhoneSimulator SDK before
    // invoking cargo. swift-rs's SwiftLinker first compiles Package.swift as a
    // *host* macOS tool (to read the package manifest), and swiftc picks up
    // SDKROOT as its sysroot. The result is a mismatch:
    //   "using sysroot for 'iPhoneSimulator' but targeting 'MacOSX'"
    // Fix: temporarily unset SDKROOT so the manifest step uses the default
    // macOS sysroot, then restore it so the actual Swift source compilation
    // picks up the correct iOS SDK. This mirrors the workaround in
    // tauri_utils::build::link_swift_library.
    //
    // set_var / remove_var are unsafe since Rust 1.87 due to thread-safety
    // concerns in multi-threaded programs. Build scripts run single-threaded,
    // so this is safe here.
    let saved_sdkroot = std::env::var_os("SDKROOT");
    unsafe { std::env::remove_var("SDKROOT") };

    SwiftLinker::new(&macos_min)
        .with_ios(&ios_min)
        .with_package("MelomaniacSync", &ios_dir)
        .link();

    if let Some(root) = saved_sdkroot {
        unsafe { std::env::set_var("SDKROOT", root) };
    }
}
