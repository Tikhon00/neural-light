import AppKit
import Foundation

let directory = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  for multiplier in [1, 2] {
    let size = base * multiplier
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: size * 4, bitsPerPixel: 32)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let scale = CGFloat(size) / 1024
    let transform = AffineTransform(scale: scale)
    (transform as NSAffineTransform).concat()
    NSColor(calibratedWhite: 0.065, alpha: 1).setFill()
    NSBezierPath(
      roundedRect: NSRect(x: 26, y: 26, width: 972, height: 972), xRadius: 220, yRadius: 220
    ).fill()
    NSColor(calibratedWhite: 0.22, alpha: 1).setStroke()
    let edge = NSBezierPath(
      roundedRect: NSRect(x: 27, y: 27, width: 970, height: 970), xRadius: 220, yRadius: 220)
    edge.lineWidth = 3
    edge.stroke()
    NSColor(calibratedWhite: 0.94, alpha: 1).setStroke()
    let mark = NSBezierPath()
    mark.lineWidth = 43
    mark.lineCapStyle = .round
    mark.lineJoinStyle = .round
    mark.move(to: NSPoint(x: 230, y: 300))
    mark.line(to: NSPoint(x: 230, y: 724))
    mark.line(to: NSPoint(x: 510, y: 300))
    mark.line(to: NSPoint(x: 510, y: 724))
    mark.move(to: NSPoint(x: 665, y: 724))
    mark.line(to: NSPoint(x: 665, y: 300))
    mark.line(to: NSPoint(x: 827, y: 300))
    mark.stroke()
    NSGraphicsContext.restoreGraphicsState()
    let suffix = multiplier == 2 ? "@2x" : ""
    try bitmap.representation(using: .png, properties: [:])!.write(
      to: directory.appendingPathComponent("icon_\(base)x\(base)\(suffix).png"))
  }
}
