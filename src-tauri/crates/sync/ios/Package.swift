// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "MelomaniacSync",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "MelomaniacSync",
            type: .static,
            targets: ["MelomaniacSync"]
        ),
    ],
    targets: [
        .target(
            name: "MelomaniacSync",
            path: "Sources/MelomaniacSync",
            linkerSettings: [
                .linkedFramework("Network"),
            ]
        ),
    ]
)
