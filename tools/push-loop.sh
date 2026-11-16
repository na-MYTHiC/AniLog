#!/usr/bin/env bash
# Runs tools/send-push.js over and over for most of a job's lifetime.
#
# Why a loop: GitHub does not honour a */15 schedule. Measured over three
# weeks, this repo's "every 15 minutes" workflow actually started every 2 to
# 10 hours — so an "episode aired" alert arrived hours late, and anything
# older than the sender's age cutoff by the time a run finally started was
# never sent at all. One job that polls every two minutes for an hour, then
# hands over to a fresh one, is the only way to get minutes-level latency out of
# Actions. The schedule stays, as a watchdog that restarts the chain.
#
# State (the last notification id sent, plus a health record the app reads)
# lives on the `push-state` branch as a single force-pushed commit. It used to
# be committed to main, which put a commit in the history for every send and
# made the push fail whenever main had moved during the run.
#
#   push-loop.sh loop    poll until the time budget is spent
#   push-loop.sh once    a single pass (manual test runs)
set -u

STATE=tools/push-state.json
BRANCH=push-state
POLL_SECONDS=120
# An hour per job, not the six GitHub allows: secrets are read when a job
# starts, so this is the longest a changed PUSH_SUBSCRIPTION or ANILIST_TOKEN
# can go unnoticed while everything is healthy.
BUDGET_SECONDS=$(( 60 * 60 ))
# While the setup is broken, end the job after one pass and this pause, so the
# next one starts with whatever the secrets hold by then — a re-paired phone
# is picked up within minutes.
BROKEN_PAUSE_SECONDS=300

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# The branch's copy wins. Before the branch exists (first run after this
# change) the copy checked out from main is the starting point.
load_state() {
  if git fetch -q origin "$BRANCH" 2>/dev/null; then
    if git show FETCH_HEAD:push-state.json > "$STATE.tmp" 2>/dev/null; then
      mv "$STATE.tmp" "$STATE"
    else
      rm -f "$STATE.tmp"
    fi
  fi
}

# One parentless commit, force-pushed: the branch never grows a history.
save_state() {
  local blob tree commit
  blob=$(git hash-object -w "$STATE") || return 1
  tree=$(printf '100644 blob %s\tpush-state.json\n' "$blob" | git mktree) || return 1
  commit=$(git commit-tree "$tree" -m "AniLog push state") || return 1
  git push -q -f origin "$commit:refs/heads/$BRANCH"
}

pass() {
  load_state
  local before rc
  before=$(cat "$STATE" 2>/dev/null || true)
  node tools/send-push.js
  rc=$?
  if [ "$(cat "$STATE" 2>/dev/null || true)" != "$before" ]; then
    save_state || echo "Could not save push state; the next pass will retry."
  fi
  return $rc
}

if [ "${1:-loop}" = "once" ]; then
  pass
  exit $?
fi

end=$(( $(date +%s) + BUDGET_SECONDS ))
while [ "$(date +%s)" -lt "$end" ]; do
  # A non-zero exit means the setup itself is broken (dead token, every
  # subscription expired) and has just been reported for the first time.
  # Stop, and let the run go red so GitHub emails about it — once.
  # The pause keeps a problem that fails every job from restarting in a tight loop.
  pass || { sleep "$BROKEN_PAUSE_SECONDS"; exit 1; }
  if node -e "process.exit(require('./$STATE').error ? 0 : 1)" 2>/dev/null; then
    echo "Setup still needs attention; handing over to a fresh job in ${BROKEN_PAUSE_SECONDS}s."
    sleep "$BROKEN_PAUSE_SECONDS"
    exit 0
  fi
  sleep "$POLL_SECONDS"
done
