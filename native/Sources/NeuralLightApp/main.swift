import AppKit
import NeuralRuntime
import WebKit

final class Application: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
  WKDownloadDelegate
{
  var window: NSWindow!, web: WKWebView!, engine: LightEngine!, assets: AssetServer?
  func applicationDidFinishLaunching(_ notification: Notification) {
    let token = UUID().uuidString + UUID().uuidString
    engine = LightEngine()
    do { try engine.start(token: token) } catch {
      let alert = NSAlert()
      alert.messageText = "Не удалось запустить движок"
      alert.informativeText = error.localizedDescription
      alert.runModal()
    }
    let config = WKWebViewConfiguration()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.underPageBackgroundColor = NSColor(red: 8 / 255, green: 10 / 255, blue: 13 / 255, alpha: 1)
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1440, height: 920),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
    )
    window.title = "NEURAL LIGHT"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.minSize = NSSize(width: 760, height: 640)
    window.backgroundColor = NSColor(red: 8 / 255, green: 10 / 255, blue: 13 / 255, alpha: 1)
    window.contentView = web
    window.center()
    window.makeKeyAndOrderFront(nil)
    let root = Bundle.main.resourceURL!.appendingPathComponent("Web")
    do { assets = try AssetServer(root: root, port: 8743) } catch {
      fputs("Asset server: \(error)\n", stderr)
    }
    var url = URLComponents(string: "http://127.0.0.1:8743/")!
    url.queryItems = [
      URLQueryItem(name: "token", value: token), URLQueryItem(name: "port", value: "8742"),
    ]
    web.load(URLRequest(url: url.url!))
    let menu = NSMenu()
    let item = NSMenuItem()
    let submenu = NSMenu()
    submenu.addItem(
      withTitle: "Завершить NEURAL LIGHT", action: #selector(NSApplication.terminate(_:)),
      keyEquivalent: "q")
    item.submenu = submenu
    menu.addItem(item)
    let edit = NSMenuItem(title: "Правка", action: nil, keyEquivalent: "")
    let editMenu = NSMenu(title: "Правка")
    for (title, action, key) in [
      ("Отменить", "undo:", "z"), ("Вырезать", "cut:", "x"), ("Копировать", "copy:", "c"),
      ("Вставить", "paste:", "v"), ("Выделить всё", "selectAll:", "a"),
    ] { editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
    edit.submenu = editMenu
    menu.addItem(edit)
    NSApplication.shared.mainMenu = menu
    NSApplication.shared.activate(ignoringOtherApps: true)
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
  func applicationWillTerminate(_ notification: Notification) {
    engine?.stop()
    assets?.stop()
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download)
      return
    }
    decisionHandler(
      (url.host == "127.0.0.1" && url.port == 8743) || url.scheme == "blob" ? .allow : .cancel)
  }
  func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) { download.delegate = self }
  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.beginSheetModal(for: window) { result in
      completionHandler(result == .OK ? panel.url : nil)
    }
  }
  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.beginSheetModal(for: window) { result in
      completionHandler(result == .OK ? panel.urls : nil)
    }
  }
}
let app = NSApplication.shared
let delegate = Application()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
