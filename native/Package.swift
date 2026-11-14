// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "NeuralLight", platforms: [.macOS(.v14)],
  products: [
    .executable(name: "neural-light-engine", targets: ["NeuralLight"]),
    .executable(name: "NeuralLightApp", targets: ["NeuralLightApp"]),
  ],
  targets: [
    .target(name: "NeuralCore"),
    .target(
      name: "NeuralRuntime", dependencies: ["NeuralCore"], resources: [.copy("Shaders.metal")]),
    .executableTarget(name: "NeuralLight", dependencies: ["NeuralRuntime", "NeuralCore"]),
    .executableTarget(name: "NeuralLightApp", dependencies: ["NeuralRuntime"]),
    .testTarget(name: "NeuralCoreTests", dependencies: ["NeuralCore", "NeuralRuntime"]),
  ])
