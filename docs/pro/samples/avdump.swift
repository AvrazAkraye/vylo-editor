import AVFoundation
// Read an MP4 the way QuickTime, Safari, Quick Look and Photos do (AVFoundation): print the asset's and
// tracks' time ranges as JSON, and write the sound as decoded (48 kHz, stereo, float32, interleaved) to
// the second argument. Scratch tool for the R2 review.
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let outPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : nil
let asset = AVURLAsset(url: url)
let sem = DispatchSemaphore(value: 0)
Task {
  var info: [String: Any] = [:]
  do {
    let dur = try await asset.load(.duration)
    info["duration"] = dur.seconds
    for t in try await asset.loadTracks(withMediaType: .video) {
      let r = try await t.load(.timeRange)
      info["videoStart"] = r.start.seconds
      info["videoDuration"] = r.duration.seconds
      let fps = try await t.load(.nominalFrameRate)
      info["videoFps"] = fps
      let size = try await t.load(.naturalSize)
      info["videoSize"] = [size.width, size.height]
    }
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    info["audioTracks"] = tracks.count
    if let track = tracks.first {
      let r = try await track.load(.timeRange)
      info["audioStart"] = r.start.seconds
      info["audioDuration"] = r.duration.seconds
      let reader = try AVAssetReader(asset: asset)
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true,
                                     AVLinearPCMIsNonInterleaved: false, AVLinearPCMIsBigEndianKey: false, AVNumberOfChannelsKey: 2, AVSampleRateKey: 48000]
      let o = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
      reader.add(o)
      reader.startReading()
      var data = Data()
      var firstPts = -1.0
      while let sb = o.copyNextSampleBuffer() {
        if firstPts < 0 { firstPts = CMSampleBufferGetPresentationTimeStamp(sb).seconds }
        guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
        var len = 0
        var ptr: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
        if let p = ptr { data.append(UnsafeBufferPointer(start: UnsafeRawPointer(p).assumingMemoryBound(to: UInt8.self), count: len)) }
      }
      info["readerStatus"] = reader.status.rawValue
      info["firstPts"] = firstPts
      info["frames"] = data.count / 8
      if let op = outPath { try data.write(to: URL(fileURLWithPath: op)) }
    }
  } catch { info["error"] = "\(error)" }
  let j = try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
  print(String(data: j, encoding: .utf8)!)
  sem.signal()
}
sem.wait()
