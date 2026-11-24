// Reader for deploy/selftest.sh (decision 0040). Plain Node, no packages, no keys.
// Prints one line per check: "ok <text>", "FAIL <text>" (a check that counts toward the two-in-a-row alert) or
// "LOW <text>" (the demo sender is below funds.warnQor). Always exits 0 when it could print its lines.
//
// What "honest" means for GET /api/demo/status:
//   - `enabled` matches config/limits.json demo.enabled
//   - every job that says ready has a lane and no reason; every job that is not ready names a reason
//   - top-level `ready` is retire.ready || cases.ready, and Retire now is ready (the judges' first button)
//   - `senderBalanceQor` matches the balance the public REST endpoint reports (within balanceToleranceQor)
//   - nothing says ready while the REST balance is below demo.minSenderBalanceQor
//   - nothing on the EVM-window lane says ready when the window has ended at the current EVM block
//
// Overrides (tests): SELFTEST_APP, SELFTEST_LIMITS, SELFTEST_ACCOUNTS, SELFTEST_URL, SELFTEST_REST, SELFTEST_EVM.
import { readFileSync } from "node:fs";

const app = JSON.parse(readFileSync(process.env.SELFTEST_APP, "utf8"));
const limits = JSON.parse(readFileSync(process.env.SELFTEST_LIMITS, "utf8"));
const accounts = JSON.parse(readFileSync(process.env.SELFTEST_ACCOUNTS, "utf8"));
const url = process.env.SELFTEST_URL;
const rest = process.env.SELFTEST_REST || app.network.rest;
const evm = process.env.SELFTEST_EVM || app.network.evmRpc;
const st = limits.selftest;
const timeout = st.timeoutSeconds * 1000;
const JOBS = ["retire", "cases", "grant"];

const lines = [];
const ok = (t) => lines.push(`ok ${t}`);
const fail = (t) => lines.push(`FAIL ${t}`);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function getJson(u, init) {
  const res = await fetch(u, { ...init, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function toQor(amount) {
  const { decimals } = app.nativeLane;
  const v = BigInt(amount);
  const unit = 10n ** BigInt(decimals);
  return Number(v / unit) + Number(v % unit) / Number(unit);
}

async function balanceQor(role) {
  const a = accounts.accounts.find((x) => x.role === role);
  if (!a) throw new Error(`no address for ${role} in evidence/accounts.json`);
  const body = await getJson(`${rest}/cosmos/bank/v1beta1/balances/${a.cosmos}/by_denom?denom=${app.nativeLane.denom}`);
  const amount = body.balance?.amount;
  if (!/^[0-9]+$/.test(String(amount))) throw new Error("no amount");
  return { address: a.cosmos, qor: toQor(amount) };
}

/** The status problems that make it dishonest or not ready. Empty = fine. */
async function statusProblems(s, demoQor) {
  const out = [];
  if (typeof s !== "object" || s === null) return ["status is not a JSON object"];
  if (s.enabled !== limits.demo.enabled) out.push(`enabled is ${s.enabled}, config says ${limits.demo.enabled}`);
  for (const j of JOBS) {
    const v = s[j];
    if (!v || typeof v.ready !== "boolean") { out.push(`${j} is missing`); continue; }
    if (v.ready && (v.reason !== null || !v.lane)) out.push(`${j} says ready but has reason ${v.reason} and lane ${v.lane}`);
    if (!v.ready && !v.reason) out.push(`${j} is not ready and names no reason`);
    if (v.ready && demoQor !== null && demoQor < limits.demo.minSenderBalanceQor)
      out.push(`${j} says ready while the sender holds ${demoQor.toFixed(2)} QOR (below ${limits.demo.minSenderBalanceQor})`);
  }
  if (s.ready !== Boolean(s.retire?.ready || s.cases?.ready)) out.push(`ready is ${s.ready} but retire/cases say otherwise`);
  if (s.retire && !s.retire.ready) out.push(`Retire now is not ready (reason ${s.retire.reason})`);
  if (demoQor !== null && typeof s.senderBalanceQor === "number" && Math.abs(s.senderBalanceQor - demoQor) > st.balanceToleranceQor)
    out.push(`senderBalanceQor ${s.senderBalanceQor} differs from the chain's ${demoQor.toFixed(2)}`);
  const onWindow = JOBS.filter((j) => s[j]?.ready && s[j]?.lane === "evm-window");
  if (onWindow.length) {
    const head = await getJson(evm, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    const block = Number(BigInt(head.result));
    const until = Number(s.evmWindow?.untilBlock ?? 0);
    if (!s.evmWindow?.live || block > until)
      out.push(`${onWindow.join(", ")} say ready on the EVM window, but it ended (block ${block}, window until ${until})`);
  }
  return out;
}

async function main() {
  let demo = null;
  try {
    demo = await balanceQor(limits.funds.role);
    const line = `${limits.funds.role} ${demo.address} holds ${demo.qor.toFixed(2)} QOR`;
    if (demo.qor < limits.funds.warnQor) lines.push(`LOW ${line}, below ${limits.funds.warnQor} QOR`);
    else ok(line);
  } catch (e) {
    fail(`balance of ${limits.funds.role} could not be read (${e.message})`);
  }
  try {
    const f = await balanceQor(app.funding.funder);
    ok(`${app.funding.funder} ${f.address} holds ${f.qor.toFixed(2)} QOR`);
  } catch (e) {
    fail(`balance of ${app.funding.funder} could not be read (${e.message})`);
  }

  // The status read is cached for a few seconds and the chain read behind it can blip: retry before failing.
  let problems = [];
  for (let i = 0; i < st.statusTries; i++) {
    try {
      problems = await statusProblems(await getJson(`${url}/api/demo/status`), demo?.qor ?? null);
    } catch (e) {
      problems = [`status could not be read (${e.message})`];
    }
    if (!problems.length) break;
    if (i + 1 < st.statusTries) await sleep(st.statusRetrySeconds);
  }
  if (problems.length) fail(`/api/demo/status: ${problems.join("; ")}`);
  else ok("/api/demo/status is honest and Retire now is ready");
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((e) => {
  process.stdout.write(`FAIL selftest reader stopped (${e.message})\n`);
});
