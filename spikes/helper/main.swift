// Kikitori audio helper (Phase 0 spike). Bun starts it and talks JSON lines over stdin/stdout:
//   in:  {"id":1,"cmd":"speak","text":"…","rate":1}
//   out: {"id":1,"ok":true,…}   or   {"id":1,"ok":false,"error":"…"}
// Commands: auth, speak, synth (speak into a file), record, play, stop, recognize.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func reply(_ id: Any?, _ fields: [String: Any]) {
  var out = fields
  out["id"] = id ?? NSNull()
  guard let data = try? JSONSerialization.data(withJSONObject: out), let line = String(data: data, encoding: .utf8) else { return }
  print(line)
}
func fail(_ id: Any?, _ error: String) { reply(id, ["ok": false, "error": error]) }

let japanese = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "ja-JP" }
  .sorted { $0.quality.rawValue > $1.quality.rawValue }.first ?? AVSpeechSynthesisVoice(language: "ja-JP")

final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
  let synth = AVSpeechSynthesizer()
  var pending: [ObjectIdentifier: () -> Void] = [:]
  override init() { super.init(); synth.delegate = self }
  func utterance(_ text: String, _ rate: Double) -> AVSpeechUtterance {
    let u = AVSpeechUtterance(string: text)
    u.voice = japanese
    u.rate = Float(Double(AVSpeechUtteranceDefaultSpeechRate) * rate)
    return u
  }
  func speak(_ text: String, rate: Double, done: @escaping () -> Void) {
    let u = utterance(text, rate)
    pending[ObjectIdentifier(u)] = done
    synth.speak(u)
  }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { pending.removeValue(forKey: ObjectIdentifier(u))?() }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { pending.removeValue(forKey: ObjectIdentifier(u))?() }

  /// Writes the utterance to a file: lets recognition be tested without a microphone.
  func synth(_ text: String, to path: String, done: @escaping (String?) -> Void) {
    var file: AVAudioFile?
    var failed: String?
    synth.write(utterance(text, 1)) { buffer in
      guard let pcm = buffer as? AVAudioPCMBuffer else { return }
      if pcm.frameLength == 0 { return done(failed) }
      do {
        if file == nil { file = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved) }
        try file?.write(from: pcm)
      } catch { failed = "\(error)" }
    }
  }
}

final class Player: NSObject, AVAudioPlayerDelegate {
  var player: AVAudioPlayer?
  var timer: Timer?
  var done: (() -> Void)?
  func play(_ path: String, start: Double, end: Double?, rate: Double, done: @escaping () -> Void) throws {
    stop()
    let p = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
    p.enableRate = true
    p.rate = Float(rate)
    p.delegate = self
    p.currentTime = start
    self.done = done
    player = p
    p.play()
    // Segment playback: stop at the cue's end.
    if let end { timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in if p.currentTime >= end { self?.stop() } } }
  }
  func stop() {
    timer?.invalidate(); timer = nil
    player?.stop(); player = nil
    let d = done; done = nil; d?()
  }
  func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully: Bool) { stop() }
}

let speaker = Speaker()
let player = Player()
var recorder: AVAudioRecorder?

func authStatus() -> [String: Any] {
  let mic: String
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: mic = "authorized"
  case .denied: mic = "denied"
  case .restricted: mic = "restricted"
  default: mic = "notDetermined"
  }
  let speech: String
  switch SFSpeechRecognizer.authorizationStatus() {
  case .authorized: speech = "authorized"
  case .denied: speech = "denied"
  case .restricted: speech = "restricted"
  default: speech = "notDetermined"
  }
  return ["mic": mic, "speech": speech]
}

func handle(_ msg: [String: Any]) {
  let id = msg["id"]
  switch msg["cmd"] as? String {
  case "auth":
    // Asking needs a usage string in the responsible app's Info.plist, or macOS kills the process.
    if msg["request"] as? Bool == true {
      AVCaptureDevice.requestAccess(for: .audio) { _ in
        SFSpeechRecognizer.requestAuthorization { _ in DispatchQueue.main.async { reply(id, ["ok": true].merging(authStatus()) { a, _ in a }) } }
      }
    } else {
      reply(id, ["ok": true].merging(authStatus()) { a, _ in a })
    }
  case "speak":
    speaker.speak(msg["text"] as? String ?? "", rate: msg["rate"] as? Double ?? 1) { reply(id, ["ok": true]) }
  case "synth":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    speaker.synth(msg["text"] as? String ?? "", to: path) { err in err == nil ? reply(id, ["ok": true, "path": path]) : fail(id, err!) }
  case "record":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1]
    do {
      let r = try AVAudioRecorder(url: URL(fileURLWithPath: path), settings: settings)
      recorder = r
      guard r.record(forDuration: msg["seconds"] as? Double ?? 5) else { return fail(id, "could not start recording (microphone permission?)") }
      Timer.scheduledTimer(withTimeInterval: (msg["seconds"] as? Double ?? 5) + 0.3, repeats: false) { _ in
        recorder = nil
        reply(id, ["ok": true, "path": path])
      }
    } catch { fail(id, "\(error)") }
  case "play":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    do {
      try player.play(path, start: msg["start"] as? Double ?? 0, end: msg["end"] as? Double, rate: msg["rate"] as? Double ?? 1) { reply(id, ["ok": true]) }
    } catch { fail(id, "\(error)") }
  case "stop":
    player.stop()
    speaker.synth.stopSpeaking(at: .immediate)
    reply(id, ["ok": true])
  case "recognize":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP")), rec.isAvailable else { return fail(id, "Japanese recognizer unavailable") }
    let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    req.shouldReportPartialResults = false
    let onDevice = rec.supportsOnDeviceRecognition
    if onDevice { req.requiresOnDeviceRecognition = true }
    rec.recognitionTask(with: req) { result, error in
      if let error { return fail(id, "\(error.localizedDescription)") }
      if let result, result.isFinal { reply(id, ["ok": true, "text": result.bestTranscription.formattedString, "onDevice": onDevice]) }
    }
  default:
    fail(id, "unknown command")
  }
}

// Read commands off the main thread; handle them on it, where AVFoundation callbacks arrive.
Thread.detachNewThread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    DispatchQueue.main.async { handle(msg) }
  }
  exit(0)
}
reply(nil, ["ready": true, "voice": japanese?.name ?? "none"])
RunLoop.main.run()
