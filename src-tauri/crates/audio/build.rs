fn main() {
    #[cfg(target_os = "ios")]
    {
        println!("cargo:rerun-if-changed=ios/Sources/MelomaniacPlayer.swift");
        tauri_build::mobile::link_swift_library("MelomaniacPlayer", "ios/Sources");
    }
}
