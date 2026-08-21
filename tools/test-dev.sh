#!/bin/sh
# The between-runs suite: everything fast that needs NO browser and NO export.
#
# Both typechecks, core, the server suite, and the deploy guards. Under a
# minute. This is what you run while working; `npm test` is what you run
# before you believe anything.
#
# Deliberately NOT here, and why: the gesture suite needs a fresh export
# first, and the export is most of a minute — so a "quick" suite carrying it
# stops being quick and starts being skipped. It runs on every deploy, which
# is the full run this one sits between. The Swift check needs swiftc and the
# desktop smoke compiles Rust; both stay manual for the same reason.
set -e
cd "$(dirname "$0")/.."

echo "==> typechecks (core src, core tests, app)"
npm run -s typecheck

echo "==> core"
npm run -s test:core -- --reporter=dot

echo "==> server"
npm run -s test:server

echo "==> peer service"
npm run -s test:peer | tail -1

echo "==> deploy guards"
sh tools/check-deploy-guards.sh | tail -2

echo ""
echo "==> test:dev green — gestures still owed before a deploy (the deploy runs them itself)"
