// Kikitori's audio helper. The app starts it and talks JSON lines over stdin/stdout:
//   in:   {"id": 3, "cmd": "speak", "text": "…", "rate": 1}
//   out:  {"event": "interim", "id": 3, "text": "…"}        events: listening, interim, time
//         {"id": 3, "ok": true, ...}  or  {"id": 3, "ok": false, "error": "…"}
// Every command ends exactly once. `stop` ends a running call (its reply says "stopped"),
// `finish` ends a listen with what was heard.
// Commands: status, speak, play, listen, finish, stop, synth.
import AVFoundation
import Foundation
import Speech

// MARK: Output (one serial queue: callbacks arrive on many threads)

let output = DispatchQueue(label: "kikitori.output")
func send(_ fields: [String: Any]) {
  output.async {
    guard let data = try? JSONSerialization.data(withJSONObject: fields), let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
  }
}

/** Running calls, by id; each ends once (main thread only). */
var running: [Int: (_ stopped: Bool) -> Void] = [:]
func fail(_ id: Int, _ error: String) {
  running.removeValue(forKey: id)
  send(["id": id, "ok": false, "error": error])
}

// MARK: Speech out

let japanese = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "ja-JP" }
  .sorted { $0.quality.rawValue > $1.quality.rawValue }.first ?? AVSpeechSynthesisVoice(language: "ja-JP")

func utterance(_ text: String, _ rate: Double, volume: Double = 1) -> AVSpeechUtterance {
  let u = AVSpeechUtterance(string: text)
  u.volume = Float(volume)
  u.voice = japanese
  u.rate = Float(min(max(Double(AVSpeechUtteranceDefaultSpeechRate) * rate, Double(AVSpeechUtteranceMinimumSpeechRate)), Double(AVSpeechUtteranceMaximumSpeechRate)))
  return u
}

final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
  let synth = AVSpeechSynthesizer()
  var ids: [ObjectIdentifier: Int] = [:]
  override init() {
    super.init()
    synth.delegate = self
  }
  func speak(_ id: Int, _ text: String, _ rate: Double, volume: Double) {
    let u = utterance(text, rate, volume: volume)
    ids[ObjectIdentifier(u)] = id
    running[id] = { [weak self] _ in
      self?.synth.stopSpeaking(at: .immediate)
    }
    synth.speak(u)
  }
  private func finished(_ u: AVSpeechUtterance, stopped: Bool) {
    guard let id = ids.removeValue(forKey: ObjectIdentifier(u)), running.removeValue(forKey: id) != nil else { return }
    send(["id": id, "ok": true, "stopped": stopped])
  }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) { finished(u, stopped: false) }
  func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel u: AVSpeechUtterance) { finished(u, stopped: true) }

  /** Speech written to a file, to test recognition without a microphone. */
  func synth(_ id: Int, _ text: String, to path: String) {
    var file: AVAudioFile?
    var failure: String?
    synth.write(utterance(text, 1)) { buffer in
      guard let pcm = buffer as? AVAudioPCMBuffer else { return }
      if pcm.frameLength == 0 {
        DispatchQueue.main.async { failure == nil ? send(["id": id, "ok": true, "path": path]) : fail(id, failure!) }
        return
      }
      do {
        if file == nil {
          file = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
        }
        try file?.write(from: pcm)
      } catch { failure = "\(error)" }
    }
  }
}

// MARK: Playback

final class Playback: NSObject, AVAudioPlayerDelegate {
  var players: [Int: (AVAudioPlayer, Timer)] = [:]
  func play(_ id: Int, _ path: String, start: Double, end endAt: Double?, rate: Double, ticks: Bool, volume: Double) throws {
    let p = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
    p.volume = Float(volume)
    p.enableRate = true
    p.rate = Float(rate)
    p.delegate = self
    p.currentTime = start
    // Stops at the cue's end (and reports progress) within a frame.
    let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { [weak self] _ in
      if ticks { send(["event": "time", "id": id, "t": p.currentTime]) }
      if let endAt, p.currentTime >= endAt { self?.done(id, stopped: false) }
    }
    players[id] = (p, timer)
    running[id] = { [weak self] stopped in self?.done(id, stopped: stopped) }
    p.play()
  }
  func done(_ id: Int, stopped: Bool) {
    guard let (p, timer) = players.removeValue(forKey: id) else { return }
    timer.invalidate()
    p.stop()
    if running.removeValue(forKey: id) != nil { send(["id": id, "ok": true, "stopped": stopped]) }
  }
  func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully: Bool) {
    if let id = players.first(where: { $0.value.0 === p })?.key { done(id, stopped: false) }
  }
}

// MARK: Listening: one microphone stream, recognised live and recorded

final class Listener {
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var file: AVAudioFile?
  var id = 0
  var path = ""
  var heard = ""
  /** The recogniser's last error, reported with the result (it often just means silence). */
  var recognitionError: String?
  var finishing: DispatchWorkItem?

  func start(_ id: Int, path: String, recognize: Bool) {
    self.id = id
    self.path = path
    heard = ""
    recognitionError = nil
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.channelCount > 0, format.sampleRate > 0 else { return fail(id, "no microphone") }
    do {
      // The tap's own format, as CAF: no conversion that could fail mid-attempt.
      file = try AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: format.settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
    } catch { return fail(id, "can't record: \(error.localizedDescription)") }
    if recognize, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP")), recognizer.isAvailable {
      let req = SFSpeechAudioBufferRecognitionRequest()
      req.shouldReportPartialResults = true
      // Not required on-device: "supported" doesn't mean the Japanese model is installed, and
      // requiring it then fails every attempt. macOS still prefers the device when it can.
      request = req
      task = recognizer.recognitionTask(with: req) { [weak self] result, error in
        DispatchQueue.main.async {
          guard let self, self.id == id else { return }
          if let result {
            self.heard = result.bestTranscription.formattedString
            send(["event": "interim", "id": id, "text": self.heard])
            if result.isFinal { self.complete() }
          } else if let error {
            self.recognitionError = error.localizedDescription
            FileHandle.standardError.write("recognition: \(error)\n".data(using: .utf8)!)
            // "No speech detected" and the like: what was heard (maybe nothing) stands.
            if self.finishing != nil { self.complete() }
          }
        }
      }
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
      try? self?.file?.write(from: buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      return fail(id, "can't open the microphone: \(error.localizedDescription)")
    }
    running[id] = { [weak self] _ in self?.cancel() }
    send(["event": "listening", "id": id])
  }

  private func closeMic() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    file = nil // closes the file
  }

  /** Stop recording; reply once the recogniser's final result arrives (or after 3 s). */
  func finish() {
    guard running[id] != nil, finishing == nil else { return }
    closeMic()
    guard let request else { return complete() }
    request.endAudio()
    let timeout = DispatchWorkItem { [weak self] in self?.complete() }
    finishing = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: timeout)
  }

  private func complete() {
    finishing?.cancel()
    finishing = nil
    task = nil
    request = nil
    if running.removeValue(forKey: id) != nil {
      var reply: [String: Any] = ["id": id, "ok": true, "text": heard, "recording": path]
      if let recognitionError { reply["recognitionError"] = recognitionError }
      send(reply)
    }
  }

  func cancel() {
    closeMic()
    task?.cancel()
    task = nil
    request = nil
    finishing?.cancel()
    finishing = nil
    if running.removeValue(forKey: id) != nil { send(["id": id, "ok": true, "stopped": true]) }
  }
}

// MARK: Permissions

func speechStatus() -> String {
  switch SFSpeechRecognizer.authorizationStatus() {
  case .authorized: "authorized"
  case .denied: "denied"
  case .restricted: "restricted"
  default: "notDetermined"
  }
}
func micStatus() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: "authorized"
  case .denied: "denied"
  case .restricted: "restricted"
  default: "notDetermined"
  }
}

/** Asks for the microphone, then speech recognition, once each. */
func withPermissions(_ then: @escaping (_ mic: Bool, _ speech: Bool) -> Void) {
  AVCaptureDevice.requestAccess(for: .audio) { mic in
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async { then(mic, status == .authorized) }
    }
  }
}

// MARK: Commands

let speaker = Speaker()
let playback = Playback()
let listener = Listener()

func handle(_ msg: [String: Any]) {
  guard let id = msg["id"] as? Int else { return }
  switch msg["cmd"] as? String {
  case "status":
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
    send(["id": id, "ok": true, "mic": micStatus(), "speech": speechStatus(), "recognizer": recognizer?.isAvailable ?? false, "onDevice": recognizer?.supportsOnDeviceRecognition ?? false, "voice": japanese?.name ?? ""])
  case "speak":
    speaker.speak(id, msg["text"] as? String ?? "", msg["rate"] as? Double ?? 1, volume: msg["volume"] as? Double ?? 1)
  case "synth":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    speaker.synth(id, msg["text"] as? String ?? "", to: path)
  case "play":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    do {
      try playback.play(id, path, start: msg["start"] as? Double ?? 0, end: msg["end"] as? Double, rate: msg["rate"] as? Double ?? 1, ticks: msg["ticks"] as? Bool ?? false, volume: msg["volume"] as? Double ?? 1)
    } catch { fail(id, "can't play: \(error.localizedDescription)") }
  case "listen":
    guard let path = msg["path"] as? String else { return fail(id, "path required") }
    if running[listener.id] != nil { listener.cancel() }
    // Reserved while permissions are asked: a stop meanwhile ends the call.
    running[id] = { _ in
      running.removeValue(forKey: id)
      send(["id": id, "ok": true, "stopped": true])
    }
    withPermissions { mic, speech in
      guard running[id] != nil else { return } // stopped while asking
      running.removeValue(forKey: id)
      guard mic else { return fail(id, "microphone permission denied") }
      // Without recognition, the attempt is still recorded (the learner rates it).
      listener.start(id, path: path, recognize: speech)
    }
  case "finish":
    if let target = msg["target"] as? Int, target == listener.id { listener.finish() }
    send(["id": id, "ok": true])
  case "stop":
    if let target = msg["target"] as? Int, let stop = running[target] { stop(true) }
    send(["id": id, "ok": true])
  default:
    fail(id, "unknown command")
  }
}

// Commands are read off the main thread and handled on it, where AVFoundation calls back.
Thread.detachNewThread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    DispatchQueue.main.async { handle(msg) }
  }
  exit(0)
}
RunLoop.main.run()
