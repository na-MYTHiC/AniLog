#!/usr/bin/env bash
# Runs every regression suite against the working tree.
#
#   npm install playwright   (once)
#   bash tests/run.sh
#
# Each suite boots the real app from a local static server and talks to a fake
# AniList that answers the way the real one does — MediaListCollection split
# per status, server-side truth that writes actually change, and failure modes
# on demand. Every one of these exists because something shipped broken.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if ! node -e "require('playwright')" 2>/dev/null; then
  echo "playwright not installed — run: npm install playwright"; exit 1
fi

# Reuse a server already on 8099 rather than failing on EADDRINUSE.
if curl -s -o /dev/null http://localhost:8099/index.html 2>/dev/null; then
  echo "(using the static server already on :8099)"
else
  ROOT="$ROOT" node tests/static.js & SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 2
fi

fail=0
for t in regress test-mylist test-mylist-fresh test-realflow test-ratelimit \
         test-poisoned test-addtolist test-stampede test-failstates test-newviews; do
  printf '%-24s ' "$t"
  if out=$(cd tests && timeout 300 node "$t.js" 2>&1); then echo ok
  else echo FAILED; echo "$out" | tail -12; fail=1; fi
done
exit $fail
