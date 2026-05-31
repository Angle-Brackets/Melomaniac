// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "MelomaniacPlayer",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "MelomaniacPlayer",
            type: .static,
            targets: ["MelomaniacPlayer"]
        ),
    ],
    targets: [
        .target(
            name: "MelomaniacPlayer",
            path: "Sources/MelomaniacPlayer",
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("MediaPlayer"),
                .linkedFramework("SafariServices"),
            ]
        ),
    ]
)
