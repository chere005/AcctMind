//  AcctMind's half of iCloud sync.
//
//  NSUbiquitousKeyValueStore — Apple's key-value store, synced between every
//  device signed into one iCloud account. Chosen over CloudKit because the
//  ledger is one small JSON document and this is the whole of the transport:
//  no schema, no record types, no server, and the same code on the phone and
//  on the Mac (which runs this identical binary under "Designed for iPad").
//
//  WHAT IT COSTS, and why the JS side is written the way it is:
//
//   · One megabyte for the whole store, and 1MB per key. A ledger of ~120
//     bytes a row leaves room for thousands of transactions, not millions.
//     `remainingBytes` is exposed so the app can say something honest before
//     it hits the wall rather than after.
//   · It is EVENTUALLY consistent and gives no delivery guarantee. A write
//     may land seconds or minutes later, and `synchronize()` only schedules
//     the upload — it does not perform it. So the JS side never treats a
//     write as an arrival, and never treats an absent remote as an empty
//     ledger.
//   · Changes arrive as a NOTIFICATION with no ordering promise, which is
//     exactly why the merge in packages/core has to be commutative and
//     idempotent. This file does no merging at all; it moves an opaque
//     string and says when it changed.
//
//  It is unavailable when the user is not signed into iCloud, which is a
//  normal state and not an error: `isAvailable` reports it and the app keeps
//  working entirely locally.

import ExpoModulesCore

public class ICloudSyncModule: Module {
  /// One key holds the whole store. See the header for why that is fine here
  /// and would not be at a larger size.
  private static let key = "acctmind.store"

  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ICloudSync")

    Events("onRemoteChange")

    /// Whether iCloud is usable right now — i.e. the user is signed in.
    /// `ubiquityIdentityToken` is the documented way to ask, and it is nil
    /// both when signed out and when iCloud Drive is off for this app.
    Function("isAvailable") { () -> Bool in
      FileManager.default.ubiquityIdentityToken != nil
    }

    /// The remote copy, or nil if there has never been one.
    ///
    /// nil means "nothing up there yet" and is NOT the same as an empty
    /// ledger — the JS side must not merge an absent remote into a present
    /// local one and conclude everything was deleted.
    AsyncFunction("get") { () -> String? in
      NSUbiquitousKeyValueStore.default.string(forKey: Self.key)
    }

    /// Publish the local copy. Returns false when the payload cannot fit.
    ///
    /// The size is checked HERE rather than trusted to the store, because
    /// exceeding the quota fails silently: the value stays in the local
    /// mirror, every read on this device keeps returning it, and nothing ever
    /// reaches another device. A write that quietly stops syncing is the
    /// worst failure this module could have, so it is turned into a `false`
    /// the app can show.
    AsyncFunction("set") { (value: String) -> Bool in
      let bytes = value.lengthOfBytes(using: .utf8)
      guard bytes < 1_000_000 else { return false }
      let store = NSUbiquitousKeyValueStore.default
      store.set(value, forKey: Self.key)
      // Schedules an upload; it does not perform one and cannot be waited on.
      store.synchronize()
      return true
    }

    /// Roughly how much room is left, for an honest warning before the wall.
    Function("remainingBytes") { () -> Int in
      let used = NSUbiquitousKeyValueStore.default.string(forKey: Self.key)?
        .lengthOfBytes(using: .utf8) ?? 0
      return max(0, 1_000_000 - used)
    }

    // Only observe while JS is listening. The notification fires for changes
    // made by OTHER devices and for quota and account events; the app treats
    // all of them the same way — go and read, then merge.
    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
        object: NSUbiquitousKeyValueStore.default,
        queue: .main
      ) { [weak self] note in
        let reason = (note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int) ?? -1
        self?.sendEvent("onRemoteChange", [
          "reason": reason,
          "value": NSUbiquitousKeyValueStore.default.string(forKey: Self.key) as Any,
        ])
      }
      // Ask for whatever arrived while nobody was listening.
      NSUbiquitousKeyValueStore.default.synchronize()
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }
}
