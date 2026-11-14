import Foundation
import Network
import NeuralCore

final class ControllerSink {
  let config: Controller
  private let connection: NWConnection, queue: DispatchQueue
  private var pending: (Data, Double, UInt8)?, scheduled: DispatchWorkItem?, busy = false,
    ready = false, stopped = false
  private var nextSend: Double = 0, policy = AdaptivePolicy(), sendMs: Double = 0, sent = 0,
    dropped = 0, state = "Подключение UDP"
  init(_ config: Controller, queue: DispatchQueue) {
    self.config = config
    self.queue = queue
    connection = NWConnection(
      host: NWEndpoint.Host(config.host),
      port: NWEndpoint.Port(rawValue: config.protocol == "ddp" ? 4048 : 21324)!, using: .udp)
    connection.stateUpdateHandler = { [weak self] status in
      guard let self = self else { return }
      if case .ready = status {
        self.ready = true
        self.state = "UDP готов · без подтверждения"
        self.schedule()
      }
      if case .failed(let error) = status {
        self.ready = false
        self.pending = nil
        self.state = "Ошибка: \(error.localizedDescription)"
      }
      if case .waiting = status {
        self.ready = false
        self.state = "Ожидание сети"
      }
    }
    connection.start(queue: queue)
  }
  private var bytesPerFrame: Int { config.count * 3 + Int(ceil(Double(config.count) / 480)) * 38 }
  func submit(_ frame: Data, sequence: UInt8, deadline: Double) {
    guard !stopped else { return }
    guard config.offset * 3 + config.count * 3 <= frame.count else {
      state = "Диапазон LED вне сцены"
      return
    }
    let sliced = Data(frame[(config.offset * 3)..<((config.offset + config.count) * 3)])
    // Retain the first deadline while replacing its payload; otherwise a 60 Hz
    // producer would keep postponing a calibrated send indefinitely.
    let due = pending?.1 ?? deadline
    if pending != nil { dropped += 1 }
    pending = (sliced, due, sequence)
    schedule()
  }
  private func schedule() {
    guard ready, !busy, !stopped, scheduled == nil, let frame = pending else { return }
    let delay = max(0, max(nextSend, frame.1) - ProcessInfo.processInfo.systemUptime)
    let work = DispatchWorkItem { [weak self] in
      self?.scheduled = nil
      self?.flush()
    }
    scheduled = work
    queue.asyncAfter(deadline: .now() + delay, execute: work)
  }
  private func flush() {
    guard ready, !busy, !stopped, let frame = pending else { return }
    pending = nil
    busy = true
    let packets =
      (try?
        (config.protocol == "ddp"
        ? Packets.ddp(frame.0, sequence: frame.2) : Packets.dnrgb(frame.0))) ?? []
    guard !packets.isEmpty else {
      busy = false
      return
    }
    let start = ProcessInfo.processInfo.systemUptime
    nextSend = start + 1 / policy.fps(bytesPerFrame: bytesPerFrame, budgetKbps: config.budgetKbps)
    var remaining = packets.count
    var failed = false
    for packet in packets {
      connection.send(
        content: packet,
        completion: .contentProcessed { [weak self] error in
          guard let self = self else { return }
          failed = failed || error != nil
          remaining -= 1
          if remaining == 0 {
            self.sendMs = (ProcessInfo.processInfo.systemUptime - start) * 1000
            self.policy.observe(sendMs: self.sendMs, failed: failed)
            if failed {
              self.dropped += 1
              self.state = "Ошибка отправки"
            } else {
              self.sent += 1
              self.state = "Отправка · без подтверждения LED"
            }
            self.busy = false
            self.schedule()
          }
        })
    }
  }
  func stats() -> [String: Any] {
    [
      "id": config.id, "sent": sent, "dropped": dropped,
      "fps": policy.fps(bytesPerFrame: bytesPerFrame, budgetKbps: config.budgetKbps),
      "sendMs": sendMs, "status": state,
    ]
  }
  func stop() {
    stopped = true
    scheduled?.cancel()
    scheduled = nil
    pending = nil
    connection.cancel()
  }
}
