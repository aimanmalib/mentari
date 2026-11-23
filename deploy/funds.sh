#!/usr/bin/env bash
# Low-funds watch for the testnet accounts that pay for the demo (run from cron until the judging ends).
# Reads the watched roles and the line from config/app.json `funding` (lowBalanceRoles, lowBalanceQor), their addresses
# from evidence/accounts.json, and each balance from the public REST endpoint. Needs no key.
# One alert through NOTIFY_CMD ("<text>" warn) when an account drops below the line; one info line when all are back
# above it. Nothing is sent while the state does not change, and a REST failure changes nothing.
# Host values come from deploy/hos.env (NOTIFY_CMD). State: deploy/.funds-state (not tracked).
# Overrides (tests): FUNDS_CONFIG, FUNDS_ACCOUNTS, FUNDS_REST, FUNDS_STATE, FUNDS_NOTIFY.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck disable=SC1091
[ -r "$ROOT/deploy/hos.env" ] && . "$ROOT/deploy/hos.env"
CONFIG=${FUNDS_CONFIG:-$ROOT/config/app.json}
ACCOUNTS=${FUNDS_ACCOUNTS:-$ROOT/evidence/accounts.json}
STATE=${FUNDS_STATE:-$ROOT/deploy/.funds-state}
NOTIFY=${FUNDS_NOTIFY:-${NOTIFY_CMD:-}}

send() { [ -n "$NOTIFY" ] && "$NOTIFY" "$1" "$2" >/dev/null 2>&1; return 0; }

# One node process reads the config and the addresses, fetches each balance and prints
# "<role> (<address>) has <n> QOR;" for every watched account below the line. Any read failure exits non-zero.
low=$(node -e '
  const fs = require("fs");
  const app = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const acc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { denom, decimals } = app.nativeLane;
  const unit = 10n ** BigInt(decimals);
  const [whole, frac = ""] = String(app.funding.lowBalanceQor).split(".");
  const line = BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
  const rest = process.env.FUNDS_REST || app.network.rest;
  (async () => {
    let out = "";
    for (const role of app.funding.lowBalanceRoles) {
      const a = acc.accounts.find((x) => x.role === role);
      if (!a) throw new Error("no address for " + role);
      const url = `${rest}/cosmos/bank/v1beta1/balances/${a.cosmos}/by_denom?denom=${denom}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const amount = (await res.json()).balance?.amount;
      if (!/^[0-9]+$/.test(String(amount))) throw new Error("no amount");
      const v = BigInt(amount);
      if (v < line) out += ` ${role} (${a.cosmos}) has ${v / unit}.${String(v % unit).padStart(decimals, "0").slice(0, 2)} QOR;`;
    }
    process.stdout.write(out);
  })().catch(() => process.exit(1));' "$CONFIG" "$ACCOUNTS" 2>/dev/null) || exit 0

prev=ok
[ -f "$STATE" ] && read -r prev < "$STATE"
if [ -n "$low" ] && [ "$prev" != low ]; then
  send "Mentari testnet funds are low:$low the demo and the daily meter stop sending when gas runs out. Send test QOR to the funder account, then run pnpm native fund." warn
  prev=low
elif [ -z "$low" ] && [ "$prev" = low ]; then
  send "Mentari testnet funds are back above the low line. Nothing to do." info
  prev=ok
fi
printf '%s\n' "$prev" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
exit 0
