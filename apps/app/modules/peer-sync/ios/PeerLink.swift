//  Two devices on one wifi network, finding each other and trading ledgers.
//
//  WHAT THIS FILE IS. Bonjour for discovery (`NWListener` advertising,
//  `NWBrowser` looking), TLS with a pre-shared key for the connection, and a
//  length-prefixed frame for the payload. Nothing above that: it does not
//  know what a transaction is, does not merge, and does not decide what to
//  send. It moves opaque strings and says who they came from. Every rule
//  about what those strings MEAN lives in packages/core, where it is tested
//  without a device or a network.
//
//  WHY TLS-PSK RATHER THAN NOTHING. A socket on a café wifi is reachable by
//  everyone else on that wifi. Without authentication, anyone could read this
//  ledger or feed it invented transactions. PSK is the right primitive here
//  because there are exactly two parties, both belong to the same person, and
//  there is no certificate authority to appeal to — the shared secret IS the
//  identity. It comes from the pairing code, which is 120 bits precisely so
//  that recording a handshake off the air does not let anyone grind it out
//  afterwards.
//
//  WHY IT ONLY WORKS WHEN BOTH ARE AWAKE. iOS suspends a backgrounded app,
//  and a suspended app holds no listener. So this converges when both devices
//  are on, unlocked, and on the same network, and not otherwise. That is the
//  honest limit of the free-account approach and the app says so rather than
//  implying a sync that is always running.

import CryptoKit
import Foundation
import Network

final class PeerLink {
  /// One live connection, and the budget that stops a peer flooding it.
  private final class Conn {
    let nw: NWConnection
    init(_ nw: NWConnection) { self.nw = nw }

    /// A token bucket over RECEIVED frames.
    ///
    /// Counting frames outright was the first attempt and was wrong: a person
    /// adding ten transactions while both devices are open is a legitimate
    /// ten frames, and a connection that went quiet after N of them would
    /// look exactly like sync being broken. What actually needs bounding is
    /// the RATE — a peer feeding frames as fast as the socket allows, each
    /// one costing a merge. So: 32 to spend, one back per second, and a
    /// connection that empties the bucket is dropped rather than served.
    ///
    /// Nothing bounds what WE send. That is our own code's business, and a
    /// cap there would hide a bug rather than prevent one.
    private static let burst = 32.0
    private var tokens = burst
    private var last = Date()

    func spendToken() -> Bool {
      let now = Date()
      tokens = min(Self.burst, tokens + now.timeIntervalSince(last))
      last = now
      guard tokens >= 1 else { return false }
      tokens -= 1
      return true
    }
  }

  private let queue = DispatchQueue(label: "com.seancheren.acctmind.peerlink")

  /// This launch's identity, in the TXT record.
  ///
  /// Needed for two things a browser cannot otherwise work out: that a
  /// discovered service is THIS process (every device sees its own
  /// advertisement), and which of two devices should dial. Both would
  /// otherwise connect to each other and do the same work twice.
  private let instanceId = UUID().uuidString

  private var listener: NWListener?
  private var browser: NWBrowser?
  private var conns: [String: Conn] = [:]
  private var psk: Data?
  /// Set by `start`, from core's PEER_SERVICE. Deliberately not defaulted:
  /// a default here would be a third copy of a string that must be one.
  private var serviceType = ""
  private var maxBytes = 4 * 1024 * 1024

  // Handed up to the Expo module, which forwards them to JS.
  var onFrame: ((String, String) -> Void)?
  var onPeerReady: ((String) -> Void)?
  var onPeerGone: ((String) -> Void)?

  var peerCount: Int { queue.sync { conns.count } }
  var isRunning: Bool { queue.sync { listener != nil } }

  // MARK: - Lifecycle

  /// Begin advertising and browsing. Idempotent: a second call restarts.
  func start(secret: Data, serviceType: String, maxBytes: Int) {
    queue.async {
      self.stopLocked()
      self.serviceType = serviceType
      self.maxBytes = maxBytes
      // The typed code is a secret, not a key. One HKDF step turns 120 bits
      // into the 256 the ciphersuite wants, with a salt that pins this key to
      // this purpose — so the same code could later derive a different key
      // for a different job without the two being related.
      self.psk = Data(HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: secret),
        salt: Data("acctmind-peer-v1".utf8),
        info: Data("psk".utf8),
        outputByteCount: 32
      ).withUnsafeBytes { Data($0) })
      self.listenLocked()
      self.browseLocked()
    }
  }

  func stop() { queue.async { self.stopLocked() } }

  private func stopLocked() {
    listener?.cancel(); listener = nil
    browser?.cancel(); browser = nil
    for (_, c) in conns { c.nw.cancel() }
    conns.removeAll()
    psk = nil
  }

  // MARK: - Sending

  /// Hand a frame to one peer. False means it did not go, and says so rather
  /// than failing quietly — a sync that stops working without a word is the
  /// failure this whole feature has to avoid.
  func send(peer: String, json: String) -> Bool {
    queue.sync {
      guard let c = conns[peer] else { return false }
      let body = Data(json.utf8)
      guard body.count <= maxBytes else { return false }
      var out = Data(count: 4)
      let n = UInt32(body.count)
      out[0] = UInt8(truncatingIfNeeded: n >> 24)
      out[1] = UInt8(truncatingIfNeeded: n >> 16)
      out[2] = UInt8(truncatingIfNeeded: n >> 8)
      out[3] = UInt8(truncatingIfNeeded: n)
      out.append(body)
      c.nw.send(content: out, completion: .contentProcessed { _ in })
      return true
    }
  }

  // MARK: - TLS

  private func tlsParameters() -> NWParameters? {
    guard let psk else { return nil }
    let tls = NWProtocolTLS.Options()
    let key = psk.withUnsafeBytes { DispatchData(bytes: $0) }
    // The identity is not a secret and not a name — both ends must simply
    // agree on it, so it is a constant.
    let identity = Data("acctmind".utf8).withUnsafeBytes { DispatchData(bytes: $0) }
    sec_protocol_options_add_pre_shared_key(
      tls.securityProtocolOptions, key as __DispatchData, identity as __DispatchData)

    // And nothing else. Both of the obvious additions are wrong here, and
    // both were in this file until a standalone probe measured what actually
    // happens (scratch harness, six variants, loopback):
    //
    //  · Pinning the version — `set_min_tls_protocol_version(.TLSv13)` —
    //    BREAKS the handshake outright, with
    //    `NO_SUPPORTED_VERSIONS_ENABLED` on the client and "server closed
    //    session with no notification" on the server. Apple's pre-shared-key
    //    support lives in TLS 1.2; requiring 1.3 leaves no usable version.
    //  · Appending a ciphersuite does nothing. Asking for the TLS 1.3 suite,
    //    for ECDHE_PSK (0xD001) or for DHE_PSK (0x00AA) all negotiate the
    //    same thing regardless.
    //
    // What is actually negotiated, measured rather than assumed: TLS 1.2
    // with ciphersuite 0x00A8, TLS_PSK_WITH_AES_128_GCM_SHA256.
    //
    // THAT SUITE HAS NO FORWARD SECRECY, and this comment exists so nobody
    // believes otherwise. The traffic is authenticated and encrypted under a
    // 120-bit key, so it cannot be read or forged by anyone on the network.
    // But someone who records a session AND later obtains the pairing code
    // can decrypt what they recorded. The code never crosses the network and
    // lives in the Keychain, so obtaining it means having the device — at
    // which point the ledger is readable anyway. It is a narrow weakness, but
    // it is a real one, and it is the price of PSK on this API.
    let params = NWParameters(tls: tls)
    // Peer-to-peer wifi as well as the local network, so two devices with no
    // router between them still meet.
    params.includePeerToPeer = true
    return params
  }

  // MARK: - Advertising

  private func listenLocked() {
    guard !serviceType.isEmpty, let params = tlsParameters() else { return }
    let l: NWListener
    do { l = try NWListener(using: params) } catch { return }
    var txt = NWTXTRecord()
    txt["id"] = instanceId
    l.service = NWListener.Service(type: serviceType, txtRecord: txt)
    l.newConnectionHandler = { [weak self] nw in self?.adopt(nw) }
    l.start(queue: queue)
    listener = l
  }

  // MARK: - Browsing

  private func browseLocked() {
    guard !serviceType.isEmpty, let params = tlsParameters() else { return }
    // `bonjourWithTXTRecord`, NOT `bonjour`. The plain descriptor omits the
    // TXT record, so `result.metadata` is never `.bonjour(...)`, the guard
    // below fails for every peer, and each one is skipped by a `continue`.
    // What that looks like from outside: both devices advertise, both
    // browsers report ready, `dns-sd -B _acctmind1._tcp` on a Mac lists both
    // instances — and the two apps never see each other, with nothing logged
    // anywhere. That is exactly what happened, and browsing from the host is
    // what localised it to the browser rather than the advertisement.
    let b = NWBrowser(
      for: .bonjourWithTXTRecord(type: serviceType, domain: nil), using: params)
    b.browseResultsChangedHandler = { [weak self] results, _ in
      guard let self else { return }
      for r in results {
        // No TXT means we cannot tell this device from another, and dialling
        // ourselves is worse than missing a peer — so it is skipped. If every
        // peer is being skipped here, check includeTXTRecord above first.
        guard case let .bonjour(txt) = r.metadata, let theirs = txt["id"] else { continue }
        // Never dial our own advertisement.
        guard theirs != self.instanceId else { continue }
        // And of the two devices, only one dials. Without this both connect,
        // and the same ledger is exchanged twice over two sockets — harmless,
        // because merging is idempotent, but twice the work and twice the
        // chance of a confusing log.
        guard self.instanceId < theirs else { continue }
        guard self.conns[theirs] == nil else { continue }
        self.dial(r.endpoint, peer: theirs)
      }
    }
    b.start(queue: queue)
    browser = b
  }

  private func dial(_ endpoint: NWEndpoint, peer: String) {
    guard let params = tlsParameters() else { return }
    adopt(NWConnection(to: endpoint, using: params), peer: peer)
  }

  // MARK: - Connections

  private func adopt(_ nw: NWConnection, peer: String? = nil) {
    // An inbound connection has no TXT record to read, so it is keyed by a
    // fresh id. Identity here only has to be unique for as long as the socket
    // lives — it is a return address, not an account.
    let id = peer ?? UUID().uuidString
    let c = Conn(nw)
    // Registered SYNCHRONOUSLY, not via queue.async. Both callers already run
    // on `queue`, so an async hop would defer this past the end of the
    // current block — and `browseResultsChangedHandler` fires repeatedly. The
    // second firing would find `conns[theirs] == nil` still true and dial the
    // same peer again, leaving two sockets where the tiebreak above exists
    // precisely to leave one.
    dispatchPrecondition(condition: .onQueue(queue))
    conns[id] = c

    nw.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.readFrame(id)
        self.onPeerReady?(id)
      case .failed, .cancelled:
        self.drop(id)
      default:
        break
      }
    }
    nw.start(queue: queue)
  }

  private func drop(_ id: String) {
    queue.async {
      guard let c = self.conns.removeValue(forKey: id) else { return }
      c.nw.cancel()
      self.onPeerGone?(id)
    }
  }

  /// Read one length-prefixed frame, then queue the next.
  ///
  /// The length is checked against `maxBytes` BEFORE anything is allocated.
  /// A length-prefixed protocol on an open network is otherwise an invitation
  /// to be told that the next four gigabytes are a transaction list.
  private func readFrame(_ id: String) {
    queue.async {
      guard let c = self.conns[id] else { return }
      c.nw.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] header, _, _, error in
        guard let self else { return }
        guard error == nil, let header, header.count == 4 else { self.drop(id); return }
        // Byte by byte: Data's storage carries no alignment promise, so
        // loading a UInt32 straight out of it is undefined behaviour.
        let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        guard length > 0, Int(length) <= self.maxBytes else { self.drop(id); return }
        guard c.spendToken() else { self.drop(id); return }
        c.nw.receive(
          minimumIncompleteLength: Int(length), maximumLength: Int(length)
        ) { [weak self] body, _, _, error in
          guard let self else { return }
          guard error == nil, let body, body.count == Int(length),
                let json = String(data: body, encoding: .utf8) else { self.drop(id); return }
          self.onFrame?(id, json)
          self.readFrame(id)
        }
      }
    }
  }
}
