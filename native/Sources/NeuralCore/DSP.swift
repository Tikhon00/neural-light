import Accelerate
import Foundation

public final class AudioAnalyzer {
  public let size: Int
  private let setup: vDSP_DFT_Setup
  private var window: [Float], input: [Float], zero: [Float], real: [Float], imag: [Float],
    previous: [Float]
  private var history: [Float] = [], beats: [Double] = [], lastBeat: Double = -10,
    envelope: Float = 0
  public init(size: Int = 2048) {
    precondition(size >= 64 && size.nonzeroBitCount == 1)
    self.size = size
    setup = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(size), .FORWARD)!
    window = (0..<size).map { 0.5 - 0.5 * cos(2 * .pi * Float($0) / Float(size - 1)) }
    input = Array(repeating: 0, count: size)
    zero = input
    real = input
    imag = input
    previous = Array(repeating: 0, count: size / 2)
  }
  deinit { vDSP_DFT_DestroySetup(setup) }
  public func analyze(_ samples: [Float], sampleRate: Double = 48000, time: Double) -> Features {
    var rms: Float = 0
    for i in 0..<size {
      let v = i < samples.count ? samples[i] : 0
      input[i] = v * window[i]
      rms += v * v
    }
    vDSP_DFT_Execute(setup, input, zero, &real, &imag)
    var flux: Float = 0
    for i in 0..<size / 2 {
      let m = hypot(real[i], imag[i]) * 4 / Float(size)
      flux += max(0, m - previous[i])
      previous[i] = m
    }
    let mean = history.reduce(0, +) / Float(max(1, history.count))
    let deviation = sqrt(
      history.reduce(0) { $0 + pow($1 - mean, 2) } / Float(max(1, history.count)))
    if history.count > 10 && flux > mean + max(0.015, deviation * 1.4) && time - lastBeat > 0.28
      && rms / Float(size) > 0.0001
    {
      beats.append(time)
      if beats.count > 12 { beats.removeFirst() }
      lastBeat = time
      envelope = 1
    } else {
      envelope *= 0.87
    }
    history.append(flux)
    if history.count > 43 { history.removeFirst() }
    var f = Features()
    f.capturedAt = time
    f.beat = envelope
    f.rms = sqrt(rms / Float(size))
    let intervals = zip(beats.dropFirst(), beats).map(-).filter { $0 > 0.28 && $0 < 1.5 }.sorted()
    if intervals.count >= 3 && time - lastBeat < 3 {
      f.bpm = Int((60 / intervals[intervals.count / 2]).rounded())
    }
    func energy(_ lo: Double, _ hi: Double) -> Float {
      let start = max(1, Int(lo / sampleRate * Double(size)))
      let end = min(size / 2, Int(ceil(hi / sampleRate * Double(size))))
      guard start < end else { return 0 }
      return min(1, sqrt(previous[start..<end].reduce(0) { $0 + $1 * $1 }) * 2.2)
    }
    f.bass = energy(30, 250)
    f.mid = energy(250, 2500)
    f.high = energy(2500, 16000)
    f.bands = (0..<48).map {
      energy(30 * pow(16000 / 30, Double($0) / 48), 30 * pow(16000 / 30, Double($0 + 1) / 48))
    }
    return f
  }
}
public func demoPCM(size: Int = 2048, time: Double, sampleRate: Double = 48000) -> [Float] {
  (0..<size).map { i in
    let t = time - Double(size - i) / sampleRate
    let phase = (t.truncatingRemainder(dividingBy: 0.5) + 0.5).truncatingRemainder(dividingBy: 0.5)
    let kick = sin(2 * .pi * 58 * t) * exp(-phase * 23) * 0.62
    let pad = sin(t * 2 * .pi * 220) * 0.08 + sin(t * 2 * .pi * 329.63) * 0.055
    let subphase = (t.truncatingRemainder(dividingBy: 0.25) + 0.25).truncatingRemainder(
      dividingBy: 0.25)
    return Float(kick + pad + sin(t * 2 * .pi * 6700) * exp(-subphase * 75) * 0.13)
  }
}
