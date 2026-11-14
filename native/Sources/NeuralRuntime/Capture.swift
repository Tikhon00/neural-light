import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

final class AudioMailbox {
  private let lock = NSLock()
  private var ring = Array(repeating: Float(0), count: 2048), cursor = 0
  private var rate: Double = 48000, timestamp: Double = 0, color = SIMD3<Float>(repeating: 0)
  func append(_ data: UnsafePointer<Float>, count: Int, stride: Int = 1, rate: Double) {
    lock.lock()
    defer { lock.unlock() }
    for i in 0..<count {
      ring[cursor] = data[i * stride]
      cursor = (cursor + 1) % ring.count
    }
    self.rate = rate
    timestamp = ProcessInfo.processInfo.systemUptime
  }
  func setColor(_ value: SIMD3<Float>) {
    lock.lock()
    color = value
    lock.unlock()
  }
  func clear() {
    lock.lock()
    ring = Array(repeating: 0, count: 2048)
    cursor = 0
    timestamp = 0
    lock.unlock()
  }
  func snapshot() -> ([Float], Double, Double, SIMD3<Float>) {
    lock.lock()
    defer { lock.unlock() }
    return (Array(ring[cursor...]) + Array(ring[..<cursor]), rate, timestamp, color)
  }
}
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, SCContentSharingPickerObserver {
  let mailbox = AudioMailbox()
  private var audio: AVAudioEngine?
  private let streamLock = NSLock()
  private var storedStream: SCStream?
  private var stream: SCStream? {
    get {
      streamLock.lock()
      defer { streamLock.unlock() }
      return storedStream
    }
    set {
      streamLock.lock()
      storedStream = newValue
      streamLock.unlock()
    }
  }
  private let queue = DispatchQueue(label: "neural.capture", qos: .userInteractive)
  private var generation = 0, desired = "demo"
  var onError: (String) -> Void = { _ in }
  func select(_ source: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    generation += 1
    let current = generation
    desired = source
    stop()
    mailbox.clear()
    if source != "demo"
      && Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") == nil
    {
      onError(
        "Для микрофона и экрана откройте NEURAL LIGHT.app: консольный движок работает без системных разрешений."
      )
      return
    }
    if source == "microphone" {
      AVCaptureDevice.requestAccess(for: .audio) { [self] granted in
        DispatchQueue.main.async {
          guard self.generation == current else { return }
          guard granted else {
            self.onError("Нет доступа к микрофону. Разрешите его в настройках macOS.")
            return
          }
          do {
            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0 && format.channelCount > 0 else {
              throw NSError(
                domain: "Audio", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Аудиовход не найден"])
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
              guard let data = buffer.floatChannelData?[0] else { return }
              self?.mailbox.append(
                data, count: Int(buffer.frameLength), stride: Int(buffer.stride),
                rate: buffer.format.sampleRate)
            }
            try engine.start()
            self.audio = engine
          } catch { self.onError(error.localizedDescription) }
        }
      }
    } else if source == "screen" {
      let picker = SCContentSharingPicker.shared
      var config = SCContentSharingPickerConfiguration()
      config.allowedPickerModes = [.singleDisplay, .singleWindow]
      picker.defaultConfiguration = config
      picker.add(self)
      picker.isActive = true
      picker.present()
    }
  }
  func stop() {
    if let audio = audio {
      audio.inputNode.removeTap(onBus: 0)
      audio.stop()
      self.audio = nil
    }
    if let stream = stream {
      stream.stopCapture(completionHandler: nil)
      self.stream = nil
    }
    SCContentSharingPicker.shared.remove(self)
  }
  func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
    onError("Выбор экрана отменён.")
  }
  func contentSharingPickerStartDidFailWithError(_ error: Error) {
    onError(error.localizedDescription)
  }
  func contentSharingPicker(
    _ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?
  ) {
    DispatchQueue.main.async {
      guard self.desired == "screen" else { return }
      let config = SCStreamConfiguration()
      config.width = 64
      config.height = 36
      config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
      config.pixelFormat = kCVPixelFormatType_32BGRA
      config.queueDepth = 3
      config.showsCursor = false
      config.capturesAudio = true
      config.sampleRate = 48000
      config.channelCount = 1
      config.excludesCurrentProcessAudio = true
      let capture = SCStream(filter: filter, configuration: config, delegate: self)
      do {
        try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
        try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
        self.stream = capture
        capture.startCapture { error in
          if let error = error { self.onError(error.localizedDescription) }
        }
      } catch { self.onError(error.localizedDescription) }
    }
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    if stream === self.stream { onError(error.localizedDescription) }
  }
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard sampleBuffer.isValid, stream === self.stream else { return }
    if type == .screen, let image = sampleBuffer.imageBuffer {
      CVPixelBufferLockBaseAddress(image, .readOnly)
      defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
      guard let base = CVPixelBufferGetBaseAddress(image) else { return }
      let width = CVPixelBufferGetWidth(image)
      let height = CVPixelBufferGetHeight(image)
      let stride = CVPixelBufferGetBytesPerRow(image)
      let bytes = base.assumingMemoryBound(to: UInt8.self)
      var sum = SIMD3<Float>(repeating: 0)
      for y in 0..<height {
        for x in 0..<width {
          let p = y * stride + x * 4
          sum += SIMD3(Float(bytes[p + 2]), Float(bytes[p + 1]), Float(bytes[p]))
        }
      }
      mailbox.setColor(sum / Float(width * height * 255))
    } else if type == .audio {
      guard let format = sampleBuffer.formatDescription,
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
        asbd.mFormatID == kAudioFormatLinearPCM, asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0,
        asbd.mBitsPerChannel == 32
      else { return }
      var block: CMBlockBuffer?
      var list = AudioBufferList(
        mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: 0, mData: nil))
      let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: &list,
        bufferListSize: MemoryLayout<AudioBufferList>.size,
        blockBufferAllocator: kCFAllocatorDefault, blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: 0, blockBufferOut: &block)
      guard status == noErr, let raw = list.mBuffers.mData else { return }
      let channels = Int(list.mBuffers.mNumberChannels)
      let count = Int(list.mBuffers.mDataByteSize) / 4 / max(1, channels)
      mailbox.append(
        raw.assumingMemoryBound(to: Float.self), count: count, stride: max(1, channels),
        rate: asbd.mSampleRate)
    }
  }
}
