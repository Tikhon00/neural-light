import Foundation

public func makeMapping(layout: String, count: Int) -> [Point] {
  guard count > 0 && count <= 8192 else { return [] }
  return (0..<count).map { i in
    let t = Float(i) / Float(max(1, count - 1))
    if layout == "strip" { return Point(t * 2 - 1, 0, 0) }
    if layout == "matrix" {
      let cols = Int(ceil(sqrt(Double(count) * 1.7)))
      let row = i / cols
      let col = i % cols
      let rows = Int(ceil(Double(count) / Double(cols)))
      return Point(
        Float(row % 2 == 1 ? cols - 1 - col : col) / Float(max(1, cols - 1)) * 2 - 1,
        Float(row) / Float(max(1, rows - 1)) * 1.4 - 0.7, 0)
    }
    if layout == "helix" { return Point(cos(t * .pi * 6) * 0.7, t * 2 - 1, sin(t * .pi * 6) * 0.7) }
    let arch = min(3, Int(Float(i) * 4 / Float(count)))
    let local = (Float(i) * 4 / Float(count) - Float(arch)) * .pi
    return Point(
      cos(local) * (0.84 - Float(arch) * 0.045), sin(local) * 1.45 - 0.65,
      (Float(arch) - 1.5) * 0.42)
  }
}
