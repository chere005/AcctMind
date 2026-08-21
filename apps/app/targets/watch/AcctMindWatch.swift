//  The watch app: the list, and the total above it.
//
//  Read-only, deliberately. Adding a transaction needs four fields and a date
//  picker, which is a phone's job; the wrist's job is the glance. The phone
//  pushes a feed and this draws it.
//
//  The transport is WatchConnectivity — see WatchSession.swift beside this,
//  and `apps/app/modules/watch-bridge` for the phone's half. It needs no
//  entitlement and no paid Apple team, which is why the wrist works even
//  though iCloud sync between the phone and the Mac does not.

import SwiftUI

@main
struct AcctMindWatchApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var session = WatchSession()

    var body: some View {
        NavigationStack {
            List {
                if !session.everReceived {
                    // Never heard from the phone. Say so, rather than drawing
                    // a $0.00 balance — a wrong number read at a glance is
                    // worse than an honest blank.
                    Text("Nothing from the phone yet")
                        .foregroundStyle(.secondary)
                        .font(.footnote)
                } else if session.feed.r.isEmpty {
                    Text("No transactions")
                        .foregroundStyle(.secondary)
                        .font(.footnote)
                } else {
                    ForEach(session.feed.r) { row in
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
            .navigationTitle(session.everReceived ? formatAmount(session.feed.t) : "AcctMind")
        }
    }
}
