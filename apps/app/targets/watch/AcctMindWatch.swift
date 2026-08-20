//  The watch app: the list, and the total above it.
//
//  Read-only, deliberately. Adding a transaction needs four fields and a date
//  picker, which is a phone's job; the wrist's job is the glance. The phone
//  pushes a feed and this draws it.
//
//  THE TRANSPORT IS NOT WIRED YET. `FeedStore` reads whatever the phone last
//  wrote into the shared container and otherwise shows the empty state. The
//  WatchConnectivity bridge — `apps/app/modules/watch-bridge` in CalMind's
//  shape — is the next piece, and it is a piece on its own precisely because
//  everything under it is already proven: the feed shape is in core, and this
//  file's decoder is checked against core's real output on every run of
//  `npm run test:watch`.

import SwiftUI

@main
struct AcctMindWatchApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

final class FeedStore: ObservableObject {
    @Published var feed: WatchFeed = .empty

    /// Where the phone leaves the feed. Until the bridge lands this is empty
    /// on a real wrist, and the view says so rather than showing a zero
    /// balance — a wrong number is worse than an honest blank.
    static let key = "acctmind.feed.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let decoded = WatchFeed.decode(data) {
            feed = decoded
        }
    }
}

struct ContentView: View {
    @StateObject private var store = FeedStore()

    var body: some View {
        NavigationStack {
            List {
                if store.feed.r.isEmpty {
                    Text("Nothing from the phone yet")
                        .foregroundStyle(.secondary)
                        .font(.footnote)
                } else {
                    ForEach(store.feed.r) { row in
                        HStack {
                            Text(row.n).lineLimit(1)
                            Spacer()
                            Text(formatAmount(row.a))
                                .monospacedDigit()
                                .foregroundStyle(row.a > 0 ? .green : .primary)
                        }
                    }
                }
            }
            .navigationTitle(formatAmount(store.feed.t))
        }
    }
}
