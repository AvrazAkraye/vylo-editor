// A minimal WKWebView host: the same system WebKit the Tauri app draws with.
//
//   webkit-host <url> <js expression> <out file> [--size WxH] [--timeout seconds]
//
// Loads `url`, waits for it to finish, evaluates `js expression` (it may return
// a Promise), and writes the result to `out`:
//   - a string  -> written as text, or as a PNG when it starts `data:image/png;base64,`
//     (or as raw bytes when it starts `data:application/octet-stream;base64,`)
//   - anything else -> JSON
// console.log / console.error from the page are printed to stdout as "log: …".
// The window is created off-screen and the app never takes focus.
import Cocoa
import WebKit

final class Host: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let web: WKWebView
  let window: NSWindow
  let expression: String
  let outPath: String
  var shot = false
  var waitMs = 0

  init(width: Int, height: Int, expression: String, outPath: String) {
    let config = WKWebViewConfiguration()
    let controller = WKUserContentController()
    let hook = """
    (function(){
      const send = (k, a) => { try { window.webkit.messageHandlers.log.postMessage(k + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); } catch (e) {} };
      const log = console.log, err = console.error;
      console.log = function(){ send('log:', Array.from(arguments)); log.apply(console, arguments); };
      console.error = function(){ send('error:', Array.from(arguments)); err.apply(console, arguments); };
      window.addEventListener('error', e => send('uncaught:', [String(e.message), String(e.filename) + ':' + e.lineno]));
      window.addEventListener('unhandledrejection', e => send('unhandled:', [String(e.reason && e.reason.stack || e.reason)]));
    })();
    """
    controller.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController = controller
    // Nothing this host loads should be kept: the system volume is nearly full.
    config.websiteDataStore = WKWebsiteDataStore.nonPersistent()
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
    window = NSWindow(contentRect: NSRect(x: -4000, y: -4000, width: width, height: height),
                      styleMask: [.borderless], backing: .buffered, defer: false)
    window.contentView = web
    self.expression = expression
    self.outPath = outPath
    super.init()
    controller.add(self, name: "log")
    web.navigationDelegate = self
  }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    if let s = message.body as? String { print(s); fflush(stdout) }
  }

  func load(_ url: URL) {
    window.orderFrontRegardless()
    web.load(URLRequest(url: url))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Give module scripts and fonts a moment, then run the expression.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.run() }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("navigation failed: \(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("load failed: \(error)") }

  func run() {
    let body = "return await (async () => { return (\(expression)); })();"
    web.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .failure(let e): self.fail("page error: \(e)")
      case .success(let value):
        if self.shot { self.snapshot() } else { self.write(value) }
      }
    }
  }

  func snapshot() {
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(waitMs, 50))) {
      let config = WKSnapshotConfiguration()
      self.web.takeSnapshot(with: config) { image, error in
        guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
          self.fail("snapshot failed: \(String(describing: error))")
          return
        }
        do {
          let url = URL(fileURLWithPath: self.outPath)
          try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
          try png.write(to: url)
          print("wrote \(self.outPath)")
          exit(0)
        } catch { self.fail("could not write \(self.outPath): \(error)") }
      }
    }
  }

  func write(_ value: Any?) {
    let url = URL(fileURLWithPath: outPath)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    do {
      if let s = value as? String {
        if s.hasPrefix("data:image/png;base64,"), let d = Data(base64Encoded: String(s.dropFirst(22))) { try d.write(to: url) }
        else if s.hasPrefix("data:application/octet-stream;base64,"), let d = Data(base64Encoded: String(s.dropFirst(37))) { try d.write(to: url) }
        else { try s.write(to: url, atomically: true, encoding: .utf8) }
      } else if let v = value, JSONSerialization.isValidJSONObject(["v": v]) {
        let d = try JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted, .fragmentsAllowed])
        try d.write(to: url)
      } else {
        try "null".write(to: url, atomically: true, encoding: .utf8)
      }
      print("wrote \(outPath)")
      exit(0)
    } catch {
      fail("could not write \(outPath): \(error)")
    }
  }

  func fail(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
  }
}

var args = Array(CommandLine.arguments.dropFirst())
func flag(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  let v = args[i + 1]
  args.removeSubrange(i...(i + 1))
  return v
}
let sizeText = flag("--size") ?? "1400x900"
let waitText = flag("--wait") ?? "0"
let shotFlag: Bool = { if let i = args.firstIndex(of: "--shot") { args.remove(at: i); return true }; return false }()
let timeout = Double(flag("--timeout") ?? "120") ?? 120
let parts = sizeText.split(separator: "x").compactMap { Int($0) }
guard args.count >= 3, parts.count == 2, let url = URL(string: args[0]) else {
  FileHandle.standardError.write("usage: webkit-host <url> <js expression> <out file> [--size WxH] [--timeout s]\n".data(using: .utf8)!)
  exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let host = Host(width: parts[0], height: parts[1], expression: args[1], outPath: args[2])
host.shot = shotFlag
host.waitMs = Int(waitText) ?? 0
host.load(url)
DispatchQueue.main.asyncAfter(deadline: .now() + timeout) {
  FileHandle.standardError.write("timed out after \(Int(timeout)) s\n".data(using: .utf8)!)
  exit(3)
}
app.run()
