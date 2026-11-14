import Foundation
import NeuralCore
import os

public final class LightEngine {
  public let queue = DispatchQueue(label: "neural.engine", qos: .userInteractive)
  private var scene = Scene(), points = makeMapping(layout: "arch", count: 240),
    analyzer = AudioAnalyzer()
  private var metal: MetalRenderer?, server: WebSocketServer?, timer: DispatchSourceTimer?
  private let capture = Capture(), log = OSLog(subsystem: "studio.neurallight", category: "render")
  private var sinks: [String: ControllerSink] = [:]
  private var elapsed: Double = 0, lastTick: Double = 0, reportTime: Double = 0, reportFrames = 0,
    frames: UInt32 = 0, dropped = 0
  private var features = Features(), renderMs: Double = 0, audioAge: Double = 0,
    backend = "Swift · CPU", revision = 0
  private var history: [(time: Double, sequence: UInt32, rgb: Data)] = []
  private var transition = FrameTransition()
  private struct SceneCommand: Decodable {
    let scene: Scene
    let transitionMs: Double?
  }
  public init() {
    do {
      let renderer = try MetalRenderer()
      metal = renderer
      backend = renderer.name
    } catch { fputs("Metal fallback: \(error)\n", stderr) }
    capture.onError = { [weak self] message in
      self?.queue.async { [weak self] in
        guard let self = self else { return }
        self.scene.source = "demo"
        self.server?.broadcast([
          "type": "error", "message": message + " Включён демотрек.", "source": "demo",
        ])
        DispatchQueue.main.async { self.capture.select("demo") }
      }
    }
  }
  public func start(port: UInt16 = 8742, token: String) throws {
    server = try WebSocketServer(port: port, token: token, queue: queue)
    server?.command = { [weak self] value in self?.handle(value) }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    self.timer = timer
    timer.schedule(
      deadline: .now(), repeating: .nanoseconds(16_666_667), leeway: .microseconds(300))
    timer.setEventHandler { [weak self] in self?.tick() }
    timer.resume()
  }
  public func stop() {
    queue.async {
      self.timer?.cancel()
      self.timer = nil
      self.server?.stop()
      self.sinks.values.forEach { $0.stop() }
      self.sinks.removeAll()
      DispatchQueue.main.async { self.capture.stop() }
    }
  }
  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
  }
  private func handle(_ message: [String: Any]) {
    do {
      switch message["type"] as? String {
      case "scene":
        let command = try decode(SceneCommand.self, message)
        let next = try command.scene.validated()
        if let duration = command.transitionMs {
          guard duration.isFinite, (0...600).contains(duration) else {
            throw ValidationError.invalidScene
          }
        }
        let old = scene
        let topologyChanged =
          old.count != next.count || old.layout != next.layout
          || old.customPoints?.count != next.customPoints?.count
          || zip(old.customPoints ?? [], next.customPoints ?? []).contains {
            $0.0.x != $0.1.x || $0.0.y != $0.1.y || $0.0.z != $0.1.z
          }
        if topologyChanged || next.brightness == 0 {
          transition.cancel()
          // Keep calibration history from replaying a bright or differently
          // addressed frame after a blackout or mapping replacement.
          history.removeAll(keepingCapacity: true)
        } else if let duration = command.transitionMs {
          if duration > 0, let last = history.last {
            transition.begin(
              from: last.rgb, time: ProcessInfo.processInfo.systemUptime, durationMs: duration)
          } else {
            transition.cancel()
          }
        }
        scene = next
        revision += 1
        points = next.customPoints ?? makeMapping(layout: next.layout, count: next.count)
        if old.source != next.source {
          analyzer = AudioAnalyzer()
          DispatchQueue.main.async { self.capture.select(next.source) }
        }
      case "seek":
        if let time = message["time"] as? Double, time.isFinite {
          elapsed = max(0, min(scene.duration, time))
          revision += 1
        }
      case "controllers":
        let configs = try decode([Controller].self, message["controllers"] ?? [])
        guard configs.count <= 16, Set(configs.map(\.id)).count == configs.count else {
          throw ValidationError.invalidController
        }
        let valid = try configs.map { try $0.validated() }
        for (id, sink) in sinks
        where !valid.contains(where: { $0.id == id && $0.enabled && $0 == sink.config }) {
          sink.stop()
          sinks.removeValue(forKey: id)
        }
        for c in valid where c.enabled && sinks[c.id] == nil {
          sinks[c.id] = ControllerSink(c, queue: queue)
        }
      default: throw ValidationError.invalidScene
      }
    } catch { server?.broadcast(["type": "error", "message": "Настройки не применены: \(error)"]) }
  }
  private func tick() {
    let now = ProcessInfo.processInfo.systemUptime
    if lastTick > 0 && scene.playing { elapsed += max(0, now - lastTick) }
    lastTick = now
    let snapshot = capture.mailbox.snapshot()
    if scene.source == "demo" {
      features = analyzer.analyze(demoPCM(time: now), time: now)
      audioAge = 0
    } else {
      features = analyzer.analyze(snapshot.0, sampleRate: snapshot.1, time: now)
      audioAge = snapshot.2 > 0 ? max(0, (now - snapshot.2) * 1000) : 0
    }
    let time = elapsed
    let currentRevision = revision
    os_signpost(.begin, log: log, name: "LED frame")
    if let metal = metal {
      let accepted = metal.render(
        scene: scene, points: points, features: features, time: time, screen: snapshot.3,
        callbackQueue: queue
      ) { [weak self] data, cost in
        guard let self = self else { return }
        os_signpost(.end, log: self.log, name: "LED frame")
        guard currentRevision == self.revision else {
          self.dropped += 1
          return
        }
        if let data = data {
          self.deliver(data, time: time, cost: cost)
        } else {
          self.metal = nil
          self.backend = "Swift · CPU"
          self.server?.broadcast([
            "type": "error", "message": "Metal недоступен. Рендеринг продолжен на CPU.",
          ])
        }
      }
      if !accepted {
        dropped += 1
        os_signpost(.end, log: log, name: "LED frame")
      }
    } else {
      let data = renderCPU(
        scene: scene, points: points, features: features, time: time, screen: snapshot.3)
      os_signpost(.end, log: log, name: "LED frame")
      deliver(data, time: time, cost: (ProcessInfo.processInfo.systemUptime - now) * 1000)
    }
  }
  private func deliver(_ rendered: Data, time: Double, cost: Double) {
    frames &+= 1
    reportFrames += 1
    let now = ProcessInfo.processInfo.systemUptime
    let rgb = transition.apply(to: rendered, time: now)
    renderMs = cost + (ProcessInfo.processInfo.systemUptime - now) * 1000
    history.append((now, frames, rgb))
    if history.count > 64 { history.removeFirst() }
    let slowest = sinks.values.map(\.config.latencyMs).max() ?? 0
    for sink in sinks.values {
      if scene.brightness == 0 {
        // Zero brightness must not wait for the history-based calibration
        // offset. The sink still obeys its bounded network scheduling policy.
        sink.submit(rgb, sequence: UInt8(frames % 15), deadline: now)
        continue
      }
      let delay = AdaptivePolicy.sendOffset(latencyMs: sink.config.latencyMs, slowestMs: slowest)
      if let frame = history.last(where: { $0.time <= now - delay }) {
        sink.submit(frame.rgb, sequence: UInt8(frame.sequence % 15), deadline: now)
      }
    }
    server?.preview(rgb, sequence: frames, time: time)
    if now - reportTime >= 0.1 {
      let fps = reportTime > 0 ? Double(reportFrames) / (now - reportTime) : 0
      let f = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(features))) ?? [:]
      server?.broadcast([
        "type": "telemetry", "fps": fps, "renderMs": renderMs, "audioAgeMs": audioAge,
        "elapsed": time, "frames": frames, "dropped": dropped, "backend": backend, "features": f,
        "devices": sinks.values.map { $0.stats() },
      ])
      reportTime = now
      reportFrames = 0
    }
  }
}
