import Foundation
import ImageIO
import CoreGraphics
// A GIF as macOS's ImageIO reads it (what Safari, Preview and Quick Look use): frame count, loop count,
// each frame's delay, and every frame composed as RGBA (premultiplied removed) to the second argument.
let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let outPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
guard let src = CGImageSourceCreateWithURL(url, nil) else { print("{\"error\":\"unreadable\"}"); exit(1) }
let count = CGImageSourceGetCount(src)
var info: [String: Any] = ["count": count, "type": CGImageSourceGetType(src) as String? ?? ""]
if let props = CGImageSourceCopyProperties(src, nil) as? [String: Any], let gif = props[kCGImagePropertyGIFDictionary as String] as? [String: Any] {
  info["loopCount"] = gif[kCGImagePropertyGIFLoopCount as String] ?? NSNull()
  info["hasGlobalColorMap"] = gif[kCGImagePropertyGIFHasGlobalColorMap as String] ?? NSNull()
}
var delays: [Double] = []
var unclamped: [Double] = []
var data = Data()
var w = 0, h = 0
for i in 0..<count {
  if let p = CGImageSourceCopyPropertiesAtIndex(src, i, nil) as? [String: Any], let g = p[kCGImagePropertyGIFDictionary as String] as? [String: Any] {
    delays.append((g[kCGImagePropertyGIFDelayTime as String] as? Double) ?? -1)
    unclamped.append((g[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double) ?? -1)
  }
  if let op = outPath, let img = CGImageSourceCreateImageAtIndex(src, i, nil) {
    w = img.width; h = img.height
    var buf = [UInt8](repeating: 0, count: w * h * 4)
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    data.append(contentsOf: buf)
    _ = op
  }
}
info["delays"] = delays
info["unclamped"] = unclamped
info["total"] = unclamped.reduce(0, +)
info["width"] = w
info["height"] = h
if let op = outPath { try! data.write(to: URL(fileURLWithPath: op)) }
let j = try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
print(String(data: j, encoding: .utf8)!)
