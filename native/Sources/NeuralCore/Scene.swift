import Foundation

public struct Point: Codable {
  public var x: Float
  public var y: Float
  public var z: Float
  public init(_ x: Float, _ y: Float, _ z: Float) {
    self.x = x
    self.y = y
    self.z = z
  }
}
public struct Layer: Codable {
  public var effect: String
  public var gain: Float
  public var audio: Bool
  public init(effect: String, gain: Float = 1, audio: Bool = true) {
    self.effect = effect
    self.gain = gain
    self.audio = audio
  }
}
public struct Clip: Codable {
  public var id: String
  public var name: String
  public var start: Double
  public var duration: Double
  public var effect: String
  public var palette: Int
}
public struct Scene: Codable {
  public var version = 1, name = "Северное сияние", effect = "aurora", palette = 0
  public var brightness: Float = 0.72, speed: Float = 0.65, spread: Float = 0.6,
    sensitivity: Float = 1
  public var count = 240, layout = "arch", source = "demo", playing = true, timelineEnabled = false
  public var duration: Double = 32
  public var clips: [Clip] = [], layers = [Layer(effect: "aurora")]
  public var customPoints: [Point]?
  public init() {}
  public static let effects = ["aurora", "pulse", "spectrum", "ember", "ocean", "screen"]
  public func validated() throws -> Scene {
    guard version == 1, name.count <= 100, Self.effects.contains(effect), (0...3).contains(palette),
      brightness.isFinite, (0...1).contains(brightness), speed.isFinite, (0.05...3).contains(speed),
      spread.isFinite, (0...1).contains(spread), sensitivity.isFinite,
      (0...3).contains(sensitivity),
      (1...8192).contains(count), ["arch", "strip", "matrix", "helix"].contains(layout),
      ["demo", "microphone", "screen"].contains(source), duration.isFinite,
      (1...3600).contains(duration),
      layers.count <= 4,
      layers.allSatisfy({
        Self.effects.contains($0.effect) && $0.gain.isFinite && (0...1).contains($0.gain)
      }),
      clips.count <= 64,
      clips.allSatisfy({
        Self.effects.contains($0.effect) && (0...3).contains($0.palette) && $0.start.isFinite
          && $0.duration.isFinite && $0.start >= 0 && $0.duration >= 0.1
          && $0.start + $0.duration <= duration + 0.001
      })
    else { throw ValidationError.invalidScene }
    if let points = customPoints {
      guard points.count == count,
        points.allSatisfy({ [$0.x, $0.y, $0.z].allSatisfy { $0.isFinite && abs($0) <= 100 } })
      else { throw ValidationError.invalidScene }
    }
    return self
  }
  public func at(_ time: Double) -> Scene {
    guard timelineEnabled else { return self }
    var result = self
    let t = time.truncatingRemainder(dividingBy: duration)
    if let clip = clips.first(where: { t >= $0.start && t < $0.start + $0.duration }) {
      result.effect = clip.effect
      result.palette = clip.palette
      result.layers = [Layer(effect: clip.effect)]
    } else {
      result.layers = []
    }
    return result
  }
}
public enum ValidationError: Error { case invalidScene, invalidController, invalidFrame }
public struct Features: Codable {
  public var bands: [Float] = Array(repeating: 0, count: 48)
  public var bass: Float = 0, mid: Float = 0, high: Float = 0, rms: Float = 0, beat: Float = 0
  public var bpm = 0
  public var capturedAt: Double = 0
  public init() {}
}
public struct Controller: Codable, Equatable {
  public var id: String, name: String, host: String
  public var count: Int, offset: Int
  public var `protocol`: String
  public var enabled: Bool
  public var latencyMs: Double, budgetKbps: Double
  public func validated() throws -> Controller {
    guard !id.isEmpty, id.count <= 100, !host.isEmpty, host.count <= 253,
      host.unicodeScalars.allSatisfy({
        CharacterSet.alphanumerics.contains($0) || ".-:".unicodeScalars.contains($0)
      }),
      (1...8192).contains(count), offset >= 0, offset + count <= 8192,
      ["ddp", "dnrgb"].contains(`protocol`), latencyMs.isFinite, (0...500).contains(latencyMs),
      budgetKbps.isFinite, (20...100000).contains(budgetKbps)
    else { throw ValidationError.invalidController }
    return self
  }
}
