import NeuralCore
import NeuralRuntime
import XCTest

final class NeuralCoreTests: XCTestCase {
  func testFFTSeparatesBands() {
    let a = AudioAnalyzer()
    let low = (0..<2048).map { Float(sin(2 * .pi * 93.75 * Double($0) / 48000) * 0.5) }
    let f = a.analyze(low, time: 1)
    XCTAssertGreaterThan(f.bass, 0.9)
    XCTAssertLessThan(f.high, 0.001)
    XCTAssertEqual(f.rms, Float(sqrt(0.125)), accuracy: 0.002)
    let silence = a.analyze(Array(repeating: 0, count: 2048), time: 2)
    XCTAssertEqual(silence.rms, 0)
    XCTAssertTrue(silence.bands.allSatisfy { $0 == 0 })
  }
  func testBeatDetectionOn120BPMPCM() {
    let a = AudioAnalyzer()
    var detected: [Int] = []
    for i in 0..<600 {
      let time = Double(i) / 60
      let f = a.analyze(demoPCM(time: time), time: time)
      if i > 300 && f.bpm > 0 { detected.append(f.bpm) }
    }
    XCTAssertFalse(detected.isEmpty)
    XCTAssertTrue(detected.contains { abs($0 - 120) <= 5 })
  }
  func testDDPFragmentationAndByteOffsets() throws {
    let rgb = Data((0..<3000).map { UInt8(truncatingIfNeeded: $0) })
    let packets = try Packets.ddp(rgb, sequence: 15)
    XCTAssertEqual(packets.count, 3)
    XCTAssertEqual(packets[0][0], 0x40)
    XCTAssertEqual(packets.last![0], 0x41)
    XCTAssertEqual(packets[0][1], 1)
    XCTAssertEqual(packets[1][6], 5)
    XCTAssertEqual(packets[1][7], 160)
    XCTAssertEqual(packets[0][8], 5)
    XCTAssertEqual(packets[0][9], 160)
    XCTAssertEqual(packets.reduce(Data()) { $0 + $1.dropFirst(10) }, rgb)
    XCTAssertTrue(packets.allSatisfy { $0.count <= 1450 })
    XCTAssertThrowsError(try Packets.ddp(Data([1]), sequence: 1))
  }
  func testDNRGBUsesLEDNotByteOffset() throws {
    let packets = try Packets.dnrgb(Data(repeating: 42, count: 1800))
    XCTAssertEqual(Array(packets[0].prefix(4)), [4, 2, 0, 0])
    XCTAssertEqual(Array(packets[1].prefix(4)), [4, 2, 1, 224])
  }
  func testMappingAndValidation() throws {
    for layout in ["arch", "strip", "matrix", "helix"] {
      let points = makeMapping(layout: layout, count: 240)
      XCTAssertEqual(points.count, 240)
      XCTAssertTrue(points.allSatisfy { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite })
    }
    var scene = Scene()
    scene.count = 0
    XCTAssertThrowsError(try scene.validated())
    scene.count = 240
    scene.brightness = .nan
    XCTAssertThrowsError(try scene.validated())
    scene = Scene()
    scene.customPoints = [Point(0, 0, 0)]
    XCTAssertThrowsError(try scene.validated())
  }
  func testAdaptiveBackpressureAndRecovery() {
    var p = AdaptivePolicy()
    XCTAssertEqual(p.fps(bytesPerFrame: 1000, budgetKbps: 2000), 60)
    p.observe(sendMs: 30, failed: false)
    XCTAssertEqual(p.level, 1)
    p.observe(sendMs: 0, failed: true)
    XCTAssertEqual(p.level, 2)
    for _ in 0..<240 { p.observe(sendMs: 1, failed: false) }
    XCTAssertEqual(p.level, 0)
    XCTAssertEqual(p.fps(bytesPerFrame: 1000, budgetKbps: 80), 10)
    XCTAssertEqual(AdaptivePolicy.sendOffset(latencyMs: 12, slowestMs: 35), 0.023, accuracy: 0.0001)
  }
  func testZeroBrightnessAndDisconnectedGraphAreBlack() {
    let points = makeMapping(layout: "arch", count: 240)
    var scene = Scene()
    scene.brightness = 0
    XCTAssertTrue(
      renderCPU(scene: scene, points: points, features: Features(), time: 1).allSatisfy { $0 == 0 })
    scene.brightness = 1
    scene.layers = []
    XCTAssertTrue(
      renderCPU(scene: scene, points: points, features: Features(), time: 1).allSatisfy { $0 == 0 })
  }
  func testMetalMatchesCPU() throws {
    let renderer = try MetalRenderer()
    let queue = DispatchQueue(label: "test.gpu")
    let points = makeMapping(layout: "helix", count: 240)
    for effect in Scene.effects {
      var scene = Scene()
      scene.effect = effect
      scene.layers = [Layer(effect: effect)]
      scene.palette = 2
      var f = Features()
      f.bass = 0.7
      f.beat = 0.8
      f.bands = Array(repeating: 0.3, count: 48)
      let expected = renderCPU(scene: scene, points: points, features: f, time: 1.25)
      let done = expectation(description: effect)
      queue.async { [scene, f] in
        XCTAssertTrue(
          renderer.render(
            scene: scene, points: points, features: f, time: 1.25, screen: SIMD3(0.3, 0.6, 0.8),
            callbackQueue: queue
          ) { data, _ in
            XCTAssertNotNil(data)
            if let data = data {
              XCTAssertEqual(data.count, expected.count)
              XCTAssertLessThanOrEqual(
                zip(data, expected).map { abs(Int($0) - Int($1)) }.max() ?? 0, 2, effect)
            }
            done.fulfill()
          })
      }
      wait(for: [done], timeout: 5)
    }
  }
}
