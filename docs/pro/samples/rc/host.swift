import Cocoa
import WebKit

// A WKWebView off screen: load a page, wait for `window.__done` (a promise of a string), write it, and a snapshot.
setvbuf(stdout, nil, _IONBF, 0)
let args = CommandLine.arguments
let url = URL(string: args[1])!
let outPath = args[2]
let shotPath = args.count > 3 ? args[3] : nil

final class Host: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { print("log: \(m.body)") }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { print("fail: \(e)"); exit(3) }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { print("fail: \(e)"); exit(3) }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    print("finished")
    w.callAsyncJavaScript("return await window.__done", arguments: [:], in: nil, in: .page) { r in
      switch r {
      case .success(let v): try? String(describing: v).write(toFile: outPath, atomically: true, encoding: .utf8)
      case .failure(let e): try? "ERROR: \(e)".write(toFile: outPath, atomically: true, encoding: .utf8)
      }
      guard let shot = shotPath else { exit(0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        w.takeSnapshot(with: nil) { img, _ in
          if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
             let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: shot)) }
          exit(0)
        }
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let cfg = WKWebViewConfiguration()
cfg.websiteDataStore = .nonPersistent()
let uc = WKUserContentController()
let host = Host()
uc.add(host, name: "log")
uc.addUserScript(WKUserScript(source: "console.log = (...a) => window.webkit.messageHandlers.log.postMessage(a.map(String).join(' ')); console.error = console.log; window.onerror = (m) => console.log('error: ' + m);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
cfg.userContentController = uc
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: cfg)
web.navigationDelegate = host
let win = NSWindow(contentRect: NSRect(x: -4000, y: -4000, width: 1100, height: 760), styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = web
win.orderBack(nil)
if url.isFileURL { web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent()) } else { web.load(URLRequest(url: url)) }
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { print("timeout"); exit(2) }
app.run()
