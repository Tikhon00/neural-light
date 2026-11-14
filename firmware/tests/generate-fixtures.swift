// Compile together with the actual Mac Packets.swift, never a copied encoder.
import Foundation

enum ValidationError: Error { case invalidFrame }

@main
struct FixtureGenerator {
  static func main() throws {
    let frame = Data((0..<3000).map { UInt8(truncatingIfNeeded: $0 * 17 + 23) })
    for packet in try Packets.ddp(frame, sequence: 14) {
      print(packet.map { String(format: "%02x", $0) }.joined())
    }
  }
}
