import Foundation

public enum Packets {
  /// DDP v1 RGB, 1440-byte payload, big-endian byte offset, PUSH only on final fragment.
  public static func ddp(_ rgb: Data, sequence: UInt8, offset: UInt32 = 0) throws -> [Data] {
    guard !rgb.isEmpty, rgb.count % 3 == 0, rgb.count <= 8192 * 3 else {
      throw ValidationError.invalidFrame
    }
    return stride(from: 0, to: rgb.count, by: 1440).map { start in
      let end = min(start + 1440, rgb.count)
      let n = end - start
      let address = offset + UInt32(start)
      var packet = Data([
        end == rgb.count ? 0x41 : 0x40, sequence % 15 + 1, 1, 1,
        UInt8(truncatingIfNeeded: address >> 24), UInt8(truncatingIfNeeded: address >> 16),
        UInt8(truncatingIfNeeded: address >> 8), UInt8(truncatingIfNeeded: address), UInt8(n >> 8),
        UInt8(n & 255),
      ])
      packet.append(rgb[start..<end])
      return packet
    }
  }
  /// WLED DNRGB: packet type 4, 2s inactivity timeout, 16-bit LED start index.
  public static func dnrgb(_ rgb: Data) throws -> [Data] {
    guard !rgb.isEmpty, rgb.count % 3 == 0, rgb.count <= 8192 * 3 else {
      throw ValidationError.invalidFrame
    }
    return stride(from: 0, to: rgb.count, by: 1440).map { start in
      let index = start / 3
      var packet = Data([4, 2, UInt8(index >> 8), UInt8(index & 255)])
      packet.append(rgb[start..<min(start + 1440, rgb.count)])
      return packet
    }
  }
}
public struct AdaptivePolicy {
  public private(set) var level = 0, goodFrames = 0
  public init() {}
  public mutating func observe(sendMs: Double, failed: Bool) {
    if failed || sendMs > 24 {
      level = min(2, level + 1)
      goodFrames = 0
    } else {
      goodFrames += 1
      if goodFrames >= 120 {
        level = max(0, level - 1)
        goodFrames = 0
      }
    }
  }
  public func fps(bytesPerFrame: Int, budgetKbps: Double) -> Double {
    let rate = [60.0, 30.0, 20.0][level]
    return min(rate, max(1, budgetKbps * 1000 / 8 / Double(max(1, bytesPerFrame))))
  }
  public static func sendOffset(latencyMs: Double, slowestMs: Double) -> Double {
    max(0, slowestMs - latencyMs) / 1000
  }
}
