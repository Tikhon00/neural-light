import Foundation
import Metal
import NeuralCore

public final class MetalRenderer {
  private let commandQueue: MTLCommandQueue, pipeline: MTLComputePipelineState
  private let positions: MTLBuffer, uniforms: MTLBuffer, output: MTLBuffer
  private var inFlight = false
  public let name: String
  public init() throws {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(),
      let positions = device.makeBuffer(length: 8192 * 16, options: .storageModeShared),
      let uniforms = device.makeBuffer(length: 80 * 4, options: .storageModeShared),
      let output = device.makeBuffer(length: 8192 * 3, options: .storageModeShared)
    else {
      throw NSError(
        domain: "Metal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Metal недоступен"])
    }
    let source = try String(
      contentsOf: Bundle.module.url(forResource: "Shaders", withExtension: "metal")!)
    let library = try device.makeLibrary(source: source, options: nil)
    pipeline = try device.makeComputePipelineState(function: library.makeFunction(name: "light")!)
    commandQueue = queue
    self.positions = positions
    self.uniforms = uniforms
    self.output = output
    name = "Metal · \(device.name)"
  }
  /// Caller and completion run on the engine serial queue. One in-flight command buffer maximum.
  @discardableResult public func render(
    scene: Scene, points: [Point], features: Features, time: Double, screen: SIMD3<Float>,
    callbackQueue: DispatchQueue, completion: @escaping (Data?, Double) -> Void
  ) -> Bool {
    guard !inFlight, let command = commandQueue.makeCommandBuffer(),
      let encoder = command.makeComputeCommandEncoder()
    else { return false }
    inFlight = true
    let start = ProcessInfo.processInfo.systemUptime
    let s = scene.at(time)
    let mapped = positions.contents().bindMemory(to: SIMD4<Float>.self, capacity: 8192)
    for i in points.indices { mapped[i] = SIMD4(points[i].x, points[i].y, points[i].z, 0) }
    let colors: [(Float, Float)] = [(0.45, 0.42), (0.04, 0.12), (0.48, 0.18), (0.08, 0.06)]
    var params = Array(repeating: Float(0), count: 80)
    let base: [Float] = [
      Float(time), s.brightness, s.speed, s.spread, s.sensitivity, features.bass, features.beat,
      colors[s.palette].0, colors[s.palette].1, Float(s.layers.count), Float(points.count),
      screen.x, screen.y, screen.z,
    ]
    params.replaceSubrange(0..<base.count, with: base)
    for (i, layer) in s.layers.enumerated() {
      params[16 + i * 4] = Float(Scene.effects.firstIndex(of: layer.effect) ?? 0)
      params[17 + i * 4] = layer.gain
      params[18 + i * 4] = layer.audio ? 1 : 0
    }
    params.replaceSubrange(32..<80, with: features.bands)
    params.withUnsafeBytes {
      uniforms.contents().copyMemory(from: $0.baseAddress!, byteCount: $0.count)
    }
    encoder.setComputePipelineState(pipeline)
    encoder.setBuffer(positions, offset: 0, index: 0)
    encoder.setBuffer(uniforms, offset: 0, index: 1)
    encoder.setBuffer(output, offset: 0, index: 2)
    encoder.dispatchThreads(
      MTLSize(width: points.count, height: 1, depth: 1),
      threadsPerThreadgroup: MTLSize(
        width: min(256, pipeline.maxTotalThreadsPerThreadgroup), height: 1, depth: 1))
    encoder.endEncoding()
    command.addCompletedHandler { [weak self] command in
      callbackQueue.async {
        guard let self = self else { return }
        self.inFlight = false
        let data =
          command.status == .completed
          ? Data(bytes: self.output.contents(), count: points.count * 3) : nil
        completion(data, (ProcessInfo.processInfo.systemUptime - start) * 1000)
      }
    }
    command.commit()
    return true
  }
}
