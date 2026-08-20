//  The watch's half of the feed contract.
//
//  This file is a DELIBERATE TWIN of `packages/core/src/watch.ts` and
//  `formatAmount` in `packages/core/src/money.ts`. A watch app is a separate
//  process in another language and cannot import TypeScript, so the rule is
//  written twice — and `tools/check-watch-feed.sh` pushes core's real output
//  through this real decoder and this real drawing code, then compares the
//  strings core says it should have produced. Two copies with a test between
//  them.
//
//  If you change how an amount is formatted, you are changing it in two
//  files. The checker is what tells you when you have only done one.

import Foundation

struct WatchRow: Decodable, Identifiable {
    let i: String
    let n: String
    let a: Int
    let d: String

    var id: String { i }
}

struct WatchFeed: Decodable {
    let v: Int
    let t: Int
    let r: [WatchRow]

    static let empty = WatchFeed(v: 1, t: 0, r: [])

    init(v: Int, t: Int, r: [WatchRow]) { self.v = v; self.t = t; self.r = r }

    /// A feed this build does not understand is not an empty feed. The caller
    /// keeps whatever it last drew rather than blanking the wrist.
    static func decode(_ data: Data) -> WatchFeed? {
        guard let feed = try? JSONDecoder().decode(WatchFeed.self, from: data),
              feed.v == 1 else { return nil }
        return feed
    }
}

/// The twin of `formatAmount` in core/money.ts.
///
/// Hand-rolled grouping, exactly as the TypeScript is, and for a related
/// reason: `NumberFormatter` is locale-dependent, so the same cents would
/// render differently on a watch set to a different region than the phone
/// beside it. The ledger is one ledger; it reads the same on both.
func formatAmount(_ cents: Int) -> String {
    let negative = cents < 0
    let abs = Swift.abs(cents)
    let whole = abs / 100
    let frac = abs % 100
    return (negative ? "-$" : "$") + group(whole) + "." + String(format: "%02d", frac)
}

/// Digits in threes from the right: 1234567 -> 1,234,567.
func group(_ n: Int) -> String {
    let s = String(n)
    var parts: [String] = []
    var end = s.endIndex
    while end > s.startIndex {
        let start = s.index(end, offsetBy: -3, limitedBy: s.startIndex) ?? s.startIndex
        parts.insert(String(s[start..<end]), at: 0)
        end = start
    }
    return parts.joined(separator: ",")
}

/// The twin of `drawnRows` in core/watch.ts. The checker compares these
/// strings, character for character, against the ones core produced.
func drawnRows(_ feed: WatchFeed) -> [String] {
    feed.r.map { "\($0.n) \(formatAmount($0.a))" }
}
