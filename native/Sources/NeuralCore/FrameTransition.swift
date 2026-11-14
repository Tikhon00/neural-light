import Foundation

/// A bounded, retargetable transition from the last displayed RGB frame to a
/// live destination. Call `begin` again with the last blended output to avoid
/// a jump when the user selects another scene before the transition finishes.
public struct FrameTransition {
  private var origin: Data?
  private var startedAt: Double = 0
  private var duration: Double = 0
  public var isActive: Bool { origin != nil }

  public init() {}

  public mutating func begin(from frame: Data, time: Double, durationMs: Double) {
    guard time.isFinite, durationMs.isFinite, durationMs > 0,
      !frame.isEmpty, frame.count <= 8192 * 3, frame.count.isMultiple(of: 3)
    else {
      cancel()
      return
    }
    origin = frame
    startedAt = time
    duration = min(durationMs, 600) / 1000
  }

  public mutating func cancel() {
    origin = nil
    duration = 0
  }

  public mutating func apply(to frame: Data, time: Double) -> Data {
    guard let origin else { return frame }
    // A different LED count is a topology change, never an interpolation of
    // unrelated pixel addresses. The engine also cancels when mapping changes.
    guard frame.count == origin.count, time.isFinite else {
      cancel()
      return frame
    }
    let progress = max(0, (time - startedAt) / duration)
    if progress >= 1 {
      cancel()
      return frame
    }
    if progress <= 0 { return origin }
    let mix = progress * progress * (3 - 2 * progress)
    var result = Data(count: frame.count)
    origin.withUnsafeBytes { sourceBytes in
      frame.withUnsafeBytes { destinationBytes in
        result.withUnsafeMutableBytes { resultBytes in
          let source = sourceBytes.bindMemory(to: UInt8.self)
          let destination = destinationBytes.bindMemory(to: UInt8.self)
          let output = resultBytes.bindMemory(to: UInt8.self)
          for index in 0..<frame.count {
            let a = Double(source[index])
            let b = Double(destination[index])
            output[index] = UInt8(clamping: Int((a + (b - a) * mix).rounded()))
          }
        }
      }
    }
    return result
  }
}
