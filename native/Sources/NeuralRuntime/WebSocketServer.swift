import Foundation
import Network

final class WebSocketServer {
  private final class Client {
    let connection: NWConnection
    var authenticated = false, sending = false
    var textQueue: [Data] = []
    var pendingTelemetry: Data?
    init(_ connection: NWConnection) { self.connection = connection }
  }
  private let listener: NWListener, queue: DispatchQueue, token: String
  private var clients: [UUID: Client] = [:]
  var command: ([String: Any]) -> Void = { _ in }
  init(port: UInt16, token: String, queue: DispatchQueue) throws {
    self.queue = queue
    self.token = token
    let options = NWProtocolWebSocket.Options()
    options.autoReplyPing = true
    options.maximumMessageSize = 1_048_576
    let parameters = NWParameters.tcp
    parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
    parameters.requiredLocalEndpoint = .hostPort(
      host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    listener = try NWListener(using: parameters)
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.stateUpdateHandler = { state in
      if case .failed(let error) = state { fputs("WebSocket: \(error)\n", stderr) }
    }
    listener.start(queue: queue)
  }
  private func accept(_ connection: NWConnection) {
    guard clients.count < 4 else {
      connection.cancel()
      return
    }
    let id = UUID()
    let client = Client(connection)
    clients[id] = client
    connection.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.clients.removeValue(forKey: id) }
      if case .cancelled = state { self?.clients.removeValue(forKey: id) }
    }
    connection.start(queue: queue)
    receive(id)
    queue.asyncAfter(deadline: .now() + 3) { [weak self, weak client] in
      if client?.authenticated == false {
        connection.cancel()
        self?.clients.removeValue(forKey: id)
      }
    }
  }
  private func receive(_ id: UUID) {
    guard let client = clients[id] else { return }
    client.connection.receiveMessage { [weak self] data, context, _, error in
      guard let self = self else { return }
      if let data = data, data.count <= 1_048_576,
        let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      {
        if !client.authenticated {
          guard value["type"] as? String == "auth", let supplied = value["token"] as? String,
            self.sameToken(supplied)
          else {
            client.connection.cancel()
            self.clients.removeValue(forKey: id)
            return
          }
          client.authenticated = true
          self.sendJSON(["type": "hello", "version": 1, "backend": "native"], to: client)
        } else if value["type"] as? String == "ping" {
          self.sendJSON(["type": "pong", "time": value["time"] ?? 0], to: client)
        } else {
          self.command(value)
        }
      }
      if error == nil {
        self.receive(id)
      } else {
        client.connection.cancel()
        self.clients.removeValue(forKey: id)
      }
    }
  }
  private func sameToken(_ value: String) -> Bool {
    let a = Array(value.utf8)
    let b = Array(token.utf8)
    guard a.count == b.count else { return false }
    return zip(a, b).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
  }
  private func sendJSON(_ object: [String: Any], to client: Client) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    if client.sending {
      if object["type"] as? String == "telemetry" {
        client.pendingTelemetry = data
        return
      }
      guard client.textQueue.count < 8 else {
        client.connection.cancel()
        return
      }
      client.textQueue.append(data)
      return
    }
    send(data, opcode: .text, to: client)
  }
  private func send(_ data: Data, opcode: NWProtocolWebSocket.Opcode, to client: Client) {
    guard !client.sending else { return }
    client.sending = true
    let metadata = NWProtocolWebSocket.Metadata(opcode: opcode)
    let context = NWConnection.ContentContext(identifier: "neural", metadata: [metadata])
    client.connection.send(
      content: data, contentContext: context, isComplete: true,
      completion: .contentProcessed { [weak self] _ in
        client.sending = false
        if !client.textQueue.isEmpty {
          let next = client.textQueue.removeFirst()
          self?.send(next, opcode: .text, to: client)
        } else if let next = client.pendingTelemetry {
          client.pendingTelemetry = nil
          self?.send(next, opcode: .text, to: client)
        }
      })
  }
  func broadcast(_ object: [String: Any]) {
    clients.values.filter(\.authenticated).forEach { sendJSON(object, to: $0) }
  }
  func preview(_ rgb: Data, sequence: UInt32, time: Double) {
    var data = Data("NL01".utf8)
    var seq = sequence.littleEndian
    var count = UInt32(rgb.count / 3).littleEndian
    var elapsed = Float(time).bitPattern.littleEndian
    withUnsafeBytes(of: &seq) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: &elapsed) { data.append(contentsOf: $0) }
    data.append(rgb)
    clients.values.filter(\.authenticated).forEach { send(data, opcode: .binary, to: $0) }
  }
  func stop() {
    listener.cancel()
    clients.values.forEach { $0.connection.cancel() }
    clients.removeAll()
  }
}
