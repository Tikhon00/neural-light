import Foundation
import NeuralCore
import NeuralRuntime

let args = CommandLine.arguments
if args.contains("--benchmark") {
  let analyzer = AudioAnalyzer()
  let samples = demoPCM(time: 3)
  var rows: [[String: Any]] = []
  for count in [240, 1000, 4096, 8192] {
    var scene = Scene()
    scene.count = count
    let points = makeMapping(layout: "arch", count: count)
    let features = analyzer.analyze(samples, time: 3)
    var costs: [Double] = []
    for i in 0..<360 {
      let start = ProcessInfo.processInfo.systemUptime
      _ = analyzer.analyze(samples, time: Double(i) / 60)
      _ = renderCPU(scene: scene, points: points, features: features, time: Double(i) / 60)
      if i >= 60 { costs.append((ProcessInfo.processInfo.systemUptime - start) * 1000) }
    }
    costs.sort()
    rows.append([
      "leds": count, "samples": costs.count, "p50Ms": costs[costs.count / 2],
      "p95Ms": costs[Int(Double(costs.count) * 0.95)],
      "p99Ms": costs[Int(Double(costs.count) * 0.99)], "backend": "Swift CPU + Accelerate FFT",
    ])
  }
  let data = try JSONSerialization.data(
    withJSONObject: [
      "hardware": ProcessInfo.processInfo.operatingSystemVersionString, "results": rows,
    ], options: [.prettyPrinted, .sortedKeys])
  print(String(data: data, encoding: .utf8)!)
  exit(0)
}
func argument(_ flag: String) -> String? {
  guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
  return args[index + 1]
}
let port = UInt16(argument("--port") ?? "8742") ?? 8742
let token = argument("--token") ?? UUID().uuidString + UUID().uuidString
let engine = LightEngine()
do {
  try engine.start(port: port, token: token)
  print("NEURAL LIGHT engine · loopback port \(port)")
} catch {
  fputs("Engine start failed: \(error)\n", stderr)
  exit(1)
}
if args.contains("--print-url") { print("http://127.0.0.1:5173/?port=\(port)&token=\(token)") }
RunLoop.main.run()
