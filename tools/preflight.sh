#!/bin/sh
# preflight — run the Release workflow's real jobs (the tag/version check, the Windows build and smoke, the macOS build)
# on GitHub against the commit you are ABOUT to tag, without tagging, publishing or failing a run.
#
#   sh tools/preflight.sh            the current HEAD; prepare derives the tag from the version in the files
#   sh tools/preflight.sh 0.56.0     the same, and the files must say 0.56.0
#
# How: HEAD is pushed to a throwaway branch preflight/<sha7> (a branch push triggers nothing: release.yml reacts only
# to version tags and manual runs), the workflow is started on it with preflight=true (every job has continue-on-error,
# so a red job does not make the RUN red and GitHub sends no failed-job mail; nothing is created, uploaded or published),
# the jobs' conclusions are read back, and the branch is deleted again whatever happens. HEAD does not have to be on
# main. tools/dtp.sh runs this right before it tags and never tags around a failure.
#
# Needs: gh, logged in, and release.yml already on the default branch (a manual run is started by workflow name).
# Exit: 0 every job succeeded, 1 a job failed (named below), 2 could not run it. Plain POSIX sh: Git Bash, macOS, Linux.
set -eu
cd "$(dirname "$0")/.."

TAG="${1:-}"
case "$TAG" in
  -*) echo "usage: sh tools/preflight.sh [<tag>]" >&2; exit 2 ;;
esac

command -v gh >/dev/null 2>&1 || { echo "preflight: the gh CLI is not installed" >&2; exit 2; }
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null | tr -d '\r') \
  || { echo "preflight: gh cannot see this repository (gh auth login?)" >&2; exit 2; }
[ -n "$REPO" ] || { echo "preflight: gh cannot see this repository (gh auth login?)" >&2; exit 2; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "preflight: note - the working tree has uncommitted changes; what is checked is the COMMIT (HEAD), not the tree" >&2
fi
SHA=$(git rev-parse HEAD)
SHORT=$(printf '%s' "$SHA" | cut -c1-7)
BRANCH="preflight/$SHORT"

PUSHED=0
cleanup() {
  if [ "$PUSHED" = 1 ]; then
    PUSHED=0
    git push -q origin --delete "$BRANCH" >/dev/null 2>&1 \
      || echo "preflight: could not delete origin/$BRANCH - delete it by hand: git push origin --delete $BRANCH" >&2
  fi
}
# An interrupted run still deletes its branch. EXIT keeps the status it was called with; the signals die as 130/143.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "preflight: pushing $SHORT to origin/$BRANCH"
git push -q origin "+$SHA:refs/heads/$BRANCH" || { echo "preflight: could not push the preflight branch" >&2; exit 2; }
PUSHED=1

# Two minutes of slack: this machine's clock has run ~17 s ahead of GitHub's, and a run it had just started was once taken for an
# older one. The run is still this branch, this commit and a manual dispatch. GNU date first, BSD (macOS) date second.
BEFORE=$(date -u -d '-120 seconds' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-120S +%Y-%m-%dT%H:%M:%SZ)

if [ -n "$TAG" ]; then
  gh workflow run release.yml --repo "$REPO" --ref "$BRANCH" -f preflight=true -f "tag=$TAG" >/dev/null \
    || { echo "preflight: could not start the Release workflow (is release.yml on the default branch?)" >&2; exit 2; }
else
  gh workflow run release.yml --repo "$REPO" --ref "$BRANCH" -f preflight=true >/dev/null \
    || { echo "preflight: could not start the Release workflow (is release.yml on the default branch?)" >&2; exit 2; }
fi

RUN=""
i=0
while [ "$i" -lt 30 ]; do
  RUN=$(gh run list --repo "$REPO" --workflow release.yml --branch "$BRANCH" --event workflow_dispatch --limit 10 \
    --json databaseId,headSha,createdAt \
    --jq "[.[] | select(.headSha == \"$SHA\" and .createdAt >= \"$BEFORE\")][0].databaseId // empty" 2>/dev/null | tr -d '\r' || true)
  [ -n "$RUN" ] && break
  i=$((i + 1))
  sleep 4
done
[ -n "$RUN" ] || { echo "preflight: the run did not appear: https://github.com/$REPO/actions" >&2; exit 2; }
echo "preflight: https://github.com/$REPO/actions/runs/$RUN"

# `gh run watch` can return early on a dropped connection: ask the run itself until it says completed (about 90 minutes at most).
echo "preflight: watching (Windows and macOS builds take a while)"
i=0
while [ "$i" -lt 180 ]; do
  gh run watch "$RUN" --repo "$REPO" --interval 30 >/dev/null 2>&1 || true
  STATUS=$(gh run view "$RUN" --repo "$REPO" --json status --jq .status 2>/dev/null | tr -d '\r' || true)
  [ "$STATUS" = "completed" ] && break
  i=$((i + 1))
  sleep 20
done
[ "$STATUS" = "completed" ] || { echo "preflight: the run did not finish in time: https://github.com/$REPO/actions/runs/$RUN" >&2; exit 2; }

JOBS=$(gh run view "$RUN" --repo "$REPO" --json jobs --jq '.jobs[] | [.name, .conclusion] | @tsv' | tr -d '\r')
printf '%s\n' "$JOBS" | sed 's/^/  /'
FAILED=$(printf '%s\n' "$JOBS" | awk -F'\t' 'NF >= 2 && $2 != "success" && $2 != "skipped" { print $1 }')
if [ -z "$JOBS" ]; then
  echo "preflight: FAIL - the run has no jobs: https://github.com/$REPO/actions/runs/$RUN"
  exit 1
fi
if [ -n "$FAILED" ]; then
  echo "preflight: FAIL ($SHORT)"
  gh run view "$RUN" --repo "$REPO" --json jobs \
    --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name as $j | (.steps[]? | select(.conclusion == "failure") | "  failed: \($j) > \(.name)")' \
    | tr -d '\r'
  echo "  logs: gh run view $RUN --repo $REPO --log-failed"
  exit 1
fi
echo "preflight: PASS ($SHORT may be tagged)"
