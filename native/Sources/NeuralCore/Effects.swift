import Foundation

public func hsv(_ hue: Float, _ s: Float, _ v: Float) -> SIMD3<Float> {
  let h = (hue.truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
  func f(_ n: Float) -> Float {
    let k = (n + h * 6).truncatingRemainder(dividingBy: 6)
    return v * (1 - s * max(0, min(k, 4 - k, 1)))
  }
  return SIMD3(f(5), f(3), f(1))
}
public func effectColor(
  _ effect: String, point p: Point, index: Int, count: Int, time: Double, scene s: Scene,
  features f: Features, screen: SIMD3<Float>
) -> SIMD3<Float> {
  let palettes: [(Float, Float)] = [(0.45, 0.42), (0.04, 0.12), (0.48, 0.18), (0.08, 0.06)]
  let palette = palettes[s.palette]
  let t = Float(time) * s.speed
  let u = Float(index) / Float(max(1, count - 1))
  let bass = min(1, f.bass * s.sensitivity)
  let beat = f.beat * min(2, s.sensitivity)
  var wave: Float = 0.5 + 0.5 * sin(p.x * (3 + s.spread * 7) + p.y * 2 + p.z * 3 - t * 1.2)
  var value: Float = 0.45 + wave * 0.4
  var hue = palette.0 + wave * palette.1
  if effect == "pulse" {
    value = 0.12 + 0.82 * beat * (1 - abs(u - 0.5))
    hue = palette.0 + u * palette.1
  }
  if effect == "spectrum" {
    value = 0.025 + min(1, f.bands[min(47, Int(u * 48))] * s.sensitivity * 2)
    hue = palette.0 + u * palette.1
  }
  if effect == "ember" {
    wave = 0.5 + 0.5 * sin(p.x * 12 + t * 2 + sin(p.y * 8 - t * 3))
    hue = 0.015 + wave * 0.085
    value = 0.25 + wave * 0.65 + bass * 0.1
  }
  if effect == "ocean" {
    wave = 0.5 + 0.5 * sin(p.x * 4 + p.z * 3 - t + sin(p.y * 4 + t * 0.6))
    hue = palette.0 + wave * palette.1
    value = 0.25 + wave * 0.55 + bass * 0.15
  }
  if effect == "screen" { return screen * s.brightness }
  return hsv(hue, 0.62 + 0.18 * wave, min(1, value * (0.75 + bass * 0.25)) * s.brightness)
}
public func renderCPU(
  scene s: Scene, points: [Point], features: Features, time: Double,
  screen: SIMD3<Float> = SIMD3(0.3, 0.6, 0.8)
) -> Data {
  let scene = s.at(time)
  var result = Data(count: points.count * 3)
  result.withUnsafeMutableBytes { (bytes: UnsafeMutableRawBufferPointer) in
    for i in points.indices {
      var color = SIMD3<Float>(repeating: 0)
      for layer in scene.layers {
        color +=
          effectColor(
            layer.effect, point: points[i], index: i, count: points.count, time: time, scene: scene,
            features: layer.audio ? features : Features(), screen: screen) * layer.gain
      }
      for c in 0..<3 { bytes[i * 3 + c] = UInt8((max(0, min(1, color[c])) * 255).rounded()) }
    }
  }
  return result
}
