//  The wrist's half of the link.
//
//  Receives the application context the phone pushes and hands it to the view.
//  There is exactly one payload — updateApplicationContext keeps only the
//  latest — so there is no queue to drain and no ordering to get wrong.
//
//  The received value is a STRING of JSON, decoded here by `WatchFeed.decode`
//  — the same decoder `tools/check-watch-feed.sh` runs core's real output
//  through. That is the point of sending a string rather than a dictionary:
//  the bytes this decodes are the bytes core produced, so the checker proves
//  something about what actually travels.

import Foundation
import WatchConnectivity

final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
  @Published var feed: WatchFeed = .empty
  /// Has the phone ever been heard from on this watch?
  @Published var everReceived = false

  /// Where the last feed is kept, so a relaunch draws immediately instead of
  /// showing an empty wrist until the phone next speaks.
  static let key = "acctmind.feed.v1"

  override init() {
    super.init()
    if let data = UserDefaults.standard.data(forKey: Self.key),
       let stored = WatchFeed.decode(data) {
      feed = stored
      everReceived = true
    }
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  /// Apply a payload, from whichever callback delivered it.
  private func apply(_ context: [String: Any]) {
    guard let json = context["feed"] as? String,
          let data = json.data(using: .utf8),
          let decoded = WatchFeed.decode(data) else { return }
    // A feed this build cannot read leaves the last good one on screen. A
    // wrist showing slightly old numbers is better than one showing none, and
    // far better than one showing zeros.
    DispatchQueue.main.async {
      self.feed = decoded
      self.everReceived = true
      UserDefaults.standard.set(data, forKey: Self.key)
    }
  }

  // Arriving while the watch app is running.
  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    apply(context)
  }

  // Arriving before it was: whatever the phone last set is waiting in
  // receivedApplicationContext at activation, and without this the watch
  // would ignore it until the phone happened to push again.
  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    guard state == .activated else { return }
    apply(session.receivedApplicationContext)
  }
}
