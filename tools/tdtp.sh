#!/bin/sh
# tdtp — test, deploy, tag, push: the full lane. Everything dtp does, with the
# whole `npm test` in front and the full (not --quick) deploy. See
# tools/dtp.sh for the lane itself.
exec sh "$(dirname "$0")/dtp.sh" --full
