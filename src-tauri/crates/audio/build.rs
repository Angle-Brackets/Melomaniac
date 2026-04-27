fn main() {
    // CARGO_CFG_TARGET_OS reflects the *target*, not the host.
    // #[cfg(target_os = "macos")] reflects the *host* (must be macOS to build iOS).
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "ios" {
        #[cfg(target_os = "macos")]
        compile_swift();
    }
}

// Only compiled when the build *host* is macOS — required for xcrun / swiftc.
#[cfg(target_os = "macos")]
fn compile_swift() {
    use swift_rs::SwiftLinker;

    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").unwrap();
    let ios_dir = std::path::PathBuf::from(manifest_dir).join("ios");

    let macos_min = std::env::var("MACOSX_DEPLOYMENT_TARGET")
        .unwrap_or_else(|_| "10.13".into());
    let ios_min = std::env::var("IPHONEOS_DEPLOYMENT_TARGET")
        .unwrap_or_else(|_| "14.0".into());

    println!("cargo:rerun-if-changed=ios/Package.swift");
    println!(
        "cargo:rerun-if-changed=ios/Sources/MelomaniacPlayer/MelomaniacPlayer.swift"
    );

    SwiftLinker::new(&macos_min)
        .with_ios(&ios_min)
        .with_package("MelomaniacPlayer", &ios_dir)
        .link();
}
