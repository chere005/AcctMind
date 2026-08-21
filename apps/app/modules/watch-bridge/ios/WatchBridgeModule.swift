//  The phone's half of the watch link.
//
//  WatchConnectivity, which needs no entitlement and no paid membership —
//  it is a direct phone-to-wrist channel, and it works with no iCloud account
//  and no network. That matters: iCloud sync needs a paid Apple Developer
//  team, and this does not, so the watch keeps working whatever is decided
//  about the phone/Mac link.
//
//  `updateApplicationContext`, not `sendMessage` or `transferUserInfo`:
//
//   · sendMessage requires the watch app to be REACHABLE right now. The watch
//     is usually asleep, so most sends would simply fail.
//   · transferUserInfo queues every payload FIFO and delivers all of them.
//     For a feed that is a full snapshot, that means the watch wakes to a
//     backlog of stale ledgers and draws each in turn.
//   · updateApplicationContext keeps exactly ONE payload — the latest — and
//     delivers it when the watch next wakes. A snapshot is the right shape
//     for it, and a superseded snapshot is worth nothing.
//
//  It is deliberately ONE-WAY. The watch draws; it does not edit. Editing
//  needs four fields and a date picker, which is a phone's job.

import ExpoModulesCore
import WatchConnectivity

public class WatchBridgeModule: Module, WCSessionDelegate {
  public func definition() -> ModuleDefinition {
    Name("WatchBridge")

    OnCreate {
      // Activating once, at module creation, rather than on first use: the
      // session takes a moment to come up, and a push that arrives before it
      // is ready is a push that is silently dropped.
      if WCSession.isSupported() {
        let session = WCSession.default
        session.delegate = self
        session.activate()
      }
    }

    /// Is there a watch to talk to? False on a Mac, an iPad, or an iPhone
    /// with no paired watch — all normal states, none of them errors.
    Function("isSupported") { () -> Bool in
      WCSession.isSupported() && WCSession.default.activationState == .activated
        && WCSession.default.isPaired && WCSession.default.isWatchAppInstalled
    }

    /// Push a feed. Returns false when it could not be handed over.
    ///
    /// The JSON is sent as a STRING rather than as a decoded dictionary: the
    /// wrist decodes the very bytes core produced, with its own decoder,
    /// which is the seam `tools/check-watch-feed.sh` tests. Handing over a
    /// dictionary would mean two different decodings and a checker that
    /// proves nothing about what actually travels.
    AsyncFunction("push") { (feedJson: String) -> Bool in
      guard WCSession.isSupported() else { return false }
      let session = WCSession.default
      guard session.activationState == .activated else { return false }
      do {
        try session.updateApplicationContext(["feed": feedJson])
        return true
      } catch {
        // Never swallowed: the app shows that the wrist is behind rather
        // than letting someone believe a stale watch is a current one.
        return false
      }
    }
  }

  // MARK: - WCSessionDelegate
  //
  // Required by the protocol; the phone side has nothing to receive, because
  // the link is one-way by design.
  public func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
  public func sessionDidBecomeInactive(_ session: WCSession) {}
  // The user paired a DIFFERENT watch. The session must be re-activated or
  // every later push goes to a wrist that is no longer there.
  public func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
