#!/usr/bin/env bash
# Self-test of the live demo while it is judged (decision 0040). Run from cron every 6 hours; needs no key.
#   1. GET /api/demo/status is honest and Retire now is ready (deploy/selftest-read.mjs lists the rules)
#   2. demo sender and funder balances from the public REST endpoint
#   3. the full public `verify` (scripts/verify.ts) passes
# A failed check alerts once through NOTIFY_CMD ("<text>" warn) after config/limits.json selftest.failsBeforeAlert runs
# in a row; the demo sender below funds.warnQor alerts once at the first run. Each recovery sends one info line.
# Prints every line and exits 1 when a check failed now (0 otherwise), so a person can run it by hand too.
# Host values come from deploy/hos.env (MENTARI_DOMAIN, NOTIFY_CMD, optional MENTARI_NODE_BIN). State: deploy/.selftest-state.
# Cron runs with PATH=/usr/bin:/bin, where node is too old: the script finds Node 22 or newer itself and checks the version.
# Overrides (tests): SELFTEST_URL, SELFTEST_STATE, SELFTEST_NOTIFY, SELFTEST_NODE, SELFTEST_VERIFY_CMD, SELFTEST_LIMITS
# and the reader's SELFTEST_* variables.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck disable=SC1091
[ -r "$ROOT/deploy/hos.env" ] && . "$ROOT/deploy/hos.env"
export SELFTEST_URL=${SELFTEST_URL:-https://${MENTARI_DOMAIN:-localhost}}
export SELFTEST_APP=${SELFTEST_APP:-$ROOT/config/app.json}
export SELFTEST_LIMITS=${SELFTEST_LIMITS:-$ROOT/config/limits.json}
export SELFTEST_ACCOUNTS=${SELFTEST_ACCOUNTS:-$ROOT/evidence/accounts.json}
STATE=${SELFTEST_STATE:-$ROOT/deploy/.selftest-state}
NOTIFY=${SELFTEST_NOTIFY:-${NOTIFY_CMD:-}}

send() { [ -n "$NOTIFY" ] && "$NOTIFY" "$1" "$2" >/dev/null 2>&1; return 0; }

NODE=${SELFTEST_NODE:-${MENTARI_NODE_BIN:-}}
if [ -z "$NODE" ]; then
  NODE=$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE" ] || NODE=$(command -v node || true)
fi

out=""
major=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "${major:-0}" -lt 22 ] 2>/dev/null; then
  out="FAIL node at '${NODE:-none}' is version ${major:-unknown}, the scripts need 22 or newer (set MENTARI_NODE_BIN in deploy/hos.env)"
else
  cfg() { "$NODE" -p "JSON.parse(require('fs').readFileSync(process.env.SELFTEST_LIMITS,'utf8')).selftest.$1"; }
  LIMIT=$(cfg failsBeforeAlert); VTIME=$(cfg verifyTimeoutSeconds)
  out=$("$NODE" "$ROOT/deploy/selftest-read.mjs" 2>&1) || true
  [ -n "$out" ] || out="FAIL selftest reader printed nothing"
  if [ -n "${SELFTEST_VERIFY_CMD:-}" ]; then
    v=$(bash -c "$SELFTEST_VERIFY_CMD" 2>&1); vrc=$?
  else
    v=$(cd "$ROOT/scripts" && PATH="$(dirname "$NODE"):/usr/bin:/bin" timeout "$VTIME" "$ROOT/node_modules/.bin/tsx" verify.ts 2>&1); vrc=$?
  fi
  sum=$(grep -E '^[0-9]+ of [0-9]+ checks passed' <<<"$v" | tail -1)
  if [ "$vrc" = 0 ] && [ -n "$sum" ]; then out+=$'\n'"ok verify: $sum"
  else out+=$'\n'"FAIL verify exited $vrc: ${sum:-$(tail -1 <<<"$v")}"; fi
fi
LIMIT=${LIMIT:-2}
printf '%s\n' "$out"

# State file: one line "<up|down> <failed runs in a row> <ok|low>".
prev=up; fails=0; funds=ok
[ -f "$STATE" ] && read -r prev fails funds < "$STATE"
[[ "${fails:-}" =~ ^[0-9]+$ ]] || fails=0
[ "$prev" = down ] || prev=up
[ "${funds:-}" = low ] || funds=ok

bad=$(grep '^FAIL ' <<<"$out" | sed 's/^FAIL //' | paste -sd ';' -)
low=$(grep '^LOW ' <<<"$out" | sed 's/^LOW //' | paste -sd ';' -)

if [ -z "$bad" ]; then
  [ "$prev" = down ] && send "Mentari demo self-test passes again: status honest, Retire now ready, verify passes. Nothing to do." info
  prev=up; fails=0
else
  fails=$((fails + 1))
  if [ "$fails" -ge "$LIMIT" ] && [ "$prev" = up ]; then
    send "Mentari demo self-test failed $fails runs in a row ($SELFTEST_URL): $bad. Judges may see a broken demo. Check the container log and the testnet; undo the last deploy with deploy/deploy.sh --rollback." warn
    prev=down
  fi
fi
if [ -n "$low" ] && [ "$funds" = ok ]; then
  send "Mentari demo sender is low on test QOR: $low. Each press costs about 0.2 QOR. Send test QOR to the funder, then run pnpm native fund." warn
  funds=low
elif [ -z "$low" ] && [ "$funds" = low ] && ! grep -q 'balance of .* could not be read' <<<"$bad"; then
  send "Mentari demo sender is back above the warning line. Nothing to do." info
  funds=ok
fi

printf '%s %s %s\n' "$prev" "$fails" "$funds" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
[ -z "$bad" ]
