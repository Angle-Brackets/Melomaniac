// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "MelomaniacOAuth",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "MelomaniacOAuth",
            type: .static,
            targets: ["MelomaniacOAuth"]
        ),
    ],
    targets: [
        .target(
            name: "MelomaniacOAuth",
            path: "Sources/MelomaniacOAuth",
            linkerSettings: [
                .linkedFramework("AuthenticationServices"),
                .linkedFramework("UIKit"),
            ]
        ),
    ]
)
