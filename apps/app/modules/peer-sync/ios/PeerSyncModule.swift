//  AcctMind's half of local-network sync.
//
//  Three jobs, and deliberately no fourth:
//
//   1. Make and keep the pairing secret. It comes from the system CSPRNG and
//      lives in the Keychain — NOT in UserDefaults, which is a plist in a
//      backup, and NOT synchronized to iCloud Keychain, because the entire
//      point of this transport is that it works for someone who has not paid
//      for an Apple Developer account and may not want Apple in the middle
//      at all.
//   2. Run the link (see PeerLink.swift).
//   3. Move opaque strings between that link and JavaScript.
//
//  It does not merge, does not parse a transaction, and does not decide what
//  to send. `planSync` in packages/core decides, on the JS side, where it is
//  tested without a device.
//
//  The secret crosses the bridge as HEX rather than as the typed code,
//  because the code's alphabet and checksum are core's and are tested there.
//  One implementation of that alphabet, in one language, is the reason there
//  is no Swift twin of it to drift.

import ExpoModulesCore
import Foundation
import Security

public class PeerSyncModule: Module {
  private let link = PeerLink()

  /// Where the pairing secret lives. Not synchronizable: see the header.
  private static let service = "com.seancheren.acctmind.peer"
  private static let account = "pairing-secret"

  public func definition() -> ModuleDefinition {
    Name("PeerSync")

    Events("onFrame", "onPeerReady", "onPeerGone")

    OnCreate {
      self.link.onFrame = { [weak self] peer, json in
        self?.sendEvent("onFrame", ["peer": peer, "json": json])
      }
      self.link.onPeerReady = { [weak self] peer in
        self?.sendEvent("onPeerReady", ["peer": peer])
      }
      self.link.onPeerGone = { [weak self] peer in
        self?.sendEvent("onPeerGone", ["peer": peer])
      }
    }

    /// The module exists, so the platform can do this. Whether the user has
    /// granted local-network access is a separate question the system asks
    /// on first use and does not let an app query.
    Function("isSupported") { () -> Bool in true }

    /// 120 bits from the system CSPRNG, as hex.
    ///
    /// `SecRandomCopyBytes` and nothing else — not `arc4random`, not a UUID.
    /// This value is the whole security of the link, so it comes from the
    /// one source that is documented for the purpose, and a failure to
    /// produce it is a thrown error rather than a fallback to something
    /// weaker.
    Function("newSecret") { () -> String in
      var bytes = [UInt8](repeating: 0, count: 15)
      guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw NoRandomException()
      }
      return bytes.map { String(format: "%02x", $0) }.joined()
    }

    Function("savedSecret") { () -> String? in Self.keychainRead() }

    Function("saveSecret") { (hex: String) -> Bool in Self.keychainWrite(hex) }

    Function("forgetSecret") { () -> Bool in
      self.link.stop()
      return Self.keychainDelete()
    }

    /// Begin advertising and browsing.
    ///
    /// The service type and the frame cap are passed IN rather than written
    /// here, so that `PEER_SERVICE` and `PEER_MAX_BYTES` have exactly one
    /// definition — in core, next to their tests — instead of a Swift copy
    /// that agrees today.
    Function("start") { (hex: String, serviceType: String, maxBytes: Int) -> Bool in
      guard let secret = Self.bytes(fromHex: hex), secret.count == 15 else { return false }
      self.link.start(secret: secret, serviceType: serviceType, maxBytes: maxBytes)
      return true
    }

    Function("stop") { () in self.link.stop() }

    Function("peerCount") { () -> Int in self.link.peerCount }

    /// Hand one frame to one peer. False means it did not go.
    Function("send") { (peer: String, json: String) -> Bool in
      self.link.send(peer: peer, json: json)
    }

    OnDestroy { self.link.stop() }
  }

  // MARK: - Keychain

  private static func query() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func keychainRead() -> String? {
    var q = query()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
          let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private static func keychainWrite(_ hex: String) -> Bool {
    // Delete first: SecItemAdd on an existing item is errSecDuplicateItem,
    // and re-pairing with a new device is a normal thing to do.
    SecItemDelete(query() as CFDictionary)
    var q = query()
    q[kSecValueData as String] = Data(hex.utf8)
    // Available after the first unlock and no later — the app never runs
    // before that — and never leaving this device.
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
  }

  private static func keychainDelete() -> Bool {
    let status = SecItemDelete(query() as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  // MARK: - Hex

  private static func bytes(fromHex hex: String) -> Data? {
    guard hex.count % 2 == 0 else { return nil }
    var out = Data(capacity: hex.count / 2)
    var i = hex.startIndex
    while i < hex.endIndex {
      let j = hex.index(i, offsetBy: 2)
      guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
      out.append(b)
      i = j
    }
    return out
  }
}

private class NoRandomException: Exception {
  override var reason: String { "the system could not produce a pairing secret" }
}
