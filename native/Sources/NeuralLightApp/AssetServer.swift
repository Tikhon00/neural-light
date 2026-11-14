import Foundation
import Network

/// Serves bundled, immutable editor assets over loopback. No filesystem or write API.
final class AssetServer {
  private let listener: NWListener, root: URL
  private let queue = DispatchQueue(label: "neural.assets", qos: .userInitiated)
  init(root: URL, port: UInt16) throws {
    self.root = root.standardizedFileURL
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(
      host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    listener = try NWListener(using: parameters)
    listener.newConnectionHandler = { [weak self] connection in
      guard let self = self else { return }
      connection.start(queue: self.queue)
      self.read(connection, buffer: Data())
    }
    listener.start(queue: queue)
  }
  private func read(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) {
      [weak self] chunk, _, complete, error in
      guard let self = self else { return }
      var buffer = buffer
      if let chunk = chunk { buffer.append(chunk) }
      guard buffer.count <= 16384, error == nil else {
        connection.cancel()
        return
      }
      if let request = String(data: buffer, encoding: .utf8), request.contains("\r\n\r\n") {
        self.respond(connection, request: request)
      } else if !complete {
        self.read(connection, buffer: buffer)
      } else {
        connection.cancel()
      }
    }
  }
  private func respond(_ connection: NWConnection, request: String) {
    let parts = request.components(separatedBy: "\r\n")[0].split(separator: " ")
    guard parts.count == 3, parts[0] == "GET",
      let components = URLComponents(string: "http://localhost\(parts[1])")
    else {
      connection.cancel()
      return
    }
    let path = components.path == "/" ? "index.html" : String(components.path.dropFirst())
    let url = root.appendingPathComponent(path).standardizedFileURL
    guard url.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: url),
      data.count <= 8_000_000
    else {
      send(
        connection,
        header: "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        data: Data())
      return
    }
    let types = [
      "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
      "css": "text/css; charset=utf-8", "svg": "image/svg+xml", "woff2": "font/woff2",
      "woff": "font/woff", "png": "image/png",
    ]
    let mime = types[url.pathExtension] ?? "application/octet-stream"
    let csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:*; media-src 'self' blob:"
    send(
      connection,
      header:
        "HTTP/1.1 200 OK\r\nContent-Type: \(mime)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: \(csp)\r\nConnection: close\r\n\r\n",
      data: data)
  }
  private func send(_ connection: NWConnection, header: String, data: Data) {
    var response = Data(header.utf8)
    response.append(data)
    connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
  }
  func stop() { listener.cancel() }
}
