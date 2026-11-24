import { useState } from "react";
import { siteConfig } from "../config.js";
import { explorer } from "../data/explorer.js";
import type { ReadingCheck } from "../data/readings.js";
import { useLoad } from "../data/useReaders.js";
import { useI18n } from "../i18n/I18n.js";
import { Seal } from "./LedgerSeam.js";
import { ExplorerNote } from "./RecordPair.js";

const links = explorer(siteConfig.explorer);
const DAY_MS = 86_400_000;

export interface PqResult {
  checks: ReadingCheck[];
  /** Time the signature checks took on this device, in milliseconds. */
  ms: number;
}

/** Reads the newest accepted readings and checks their ML-DSA-87 signatures in this browser (decision 0037). */
async function recheck(): Promise<PqResult> {
  const [{ checkReadings, fetchReadings, liveReadingChain }, { browserVerifier }] = await Promise.all([
    import("../data/readings.js"),
    import("../data/pqVerify.js"),
  ]);
  const txs = await fetchReadings((url) => fetch(url), siteConfig.readingsApi);
  let ms = 0;
  const timed: typeof browserVerifier = async (jobs) => {
    const start = performance.now();
    const out = await browserVerifier(jobs);
    ms = performance.now() - start;
    return out;
  };
  const chain = liveReadingChain(siteConfig.evmRpc, siteConfig.contract, siteConfig.pqcKeyRegistry);
  const checks = await checkReadings(txs, chain, timed, { chainId: siteConfig.evmChainId, contract: siteConfig.contract });
  return { checks, ms };
}

/** Changes one byte of the newest signature and checks it again: the answer must be "rejected". */
async function tamperedCheck(check: ReadingCheck): Promise<boolean> {
  const [{ attestMessage, bytes, liveReadingChain, tamper }, { browserVerifier }] = await Promise.all([
    import("../data/readings.js"),
    import("../data/pqVerify.js"),
  ]);
  const key = check.meter
    ? await liveReadingChain(siteConfig.evmRpc, siteConfig.contract, siteConfig.pqcKeyRegistry).keyOf(check.meter)
    : null;
  if (!key) return false;
  const { reading } = check;
  const msg = bytes(attestMessage(siteConfig.evmChainId, siteConfig.contract, reading));
  const [accepted] = await browserVerifier([{ sig: tamper(reading.sig, Math.floor((reading.sig.length - 2) / 4)), msg, pub: bytes(key) }]);
  return accepted === true;
}

type Tampered = { status: "idle" } | { status: "running" } | { status: "done"; accepted: boolean } | { status: "error" };

export function PqRecheckView({ result, tampered, onTamper }: { result: PqResult; tampered: Tampered; onTamper(): void }) {
  const { t, num, dateParts } = useI18n();
  const { checks, ms } = result;
  if (checks.length === 0) return <p className="records-status">{t("verify.pq.empty")}</p>;
  const valid = checks.filter((c) => c.signature === "valid").length;
  const agree = checks.every((c) => c.agree);
  return (
    <div className="verify-report">
      <div className={`verify-answer verify-${agree && valid === checks.length ? "ok" : "bad"}`} role="status">
        <Seal verdict={agree ? "agree" : "disagree"} className="seal-small" />
        <div>
          <p className="verify-asked">{t("verify.pq.timing", { ms: num(Math.max(1, Math.round(ms))) })}</p>
          <p className="verify-title">{t("verify.pq.summary", { valid: num(valid), total: num(checks.length) })}</p>
          <p>{agree ? t("verify.pq.agree") : t("verify.pq.disagree")}</p>
        </div>
      </div>
      <ul className="pq-list" aria-label={t("verify.pq.listLabel")}>
        {checks.map(({ reading: r, signature, chainAccepted }) => (
          <li key={r.cosmosTx} className="pq-row">
            <p className="pq-head">
              <span>{t("verify.pq.reading", { id: num(r.id), date: dateParts(r.day * DAY_MS + DAY_MS / 2).date })}</span>
              <span className="pq-wh">{t("verify.pq.wh", { wh: num(r.wh) })}</span>
            </p>
            <ul className="verify-checks">
              <li className={signature === "valid" ? "check-ok" : "check-bad"}>
                <span className="check-mark" aria-hidden="true">
                  {signature === "valid" ? "✓" : "✕"}
                </span>
                <span>{t(`verify.pq.sig.${signature}`)}</span>
              </li>
              <li className={chainAccepted ? "check-ok" : "check-bad"}>
                <span className="check-mark" aria-hidden="true">
                  {chainAccepted ? "✓" : "✕"}
                </span>
                <span>{chainAccepted ? t("verify.pq.chainYes") : t("verify.pq.chainNo")}</span>
              </li>
            </ul>
            <a className="pq-tx" href={links.tx(r.cosmosTx)} target="_blank" rel="noreferrer">
              {t("verify.pq.tx")} <code>{r.cosmosTx.slice(0, 8)}…</code>
            </a>
          </li>
        ))}
      </ul>
      <div className="pq-tamper">
        <button type="button" className="button button-quiet" onClick={onTamper} disabled={tampered.status === "running"}>
          {t("verify.pq.tamper")}
        </button>
        <p aria-live="polite" className={tampered.status === "done" && tampered.accepted ? "field-error" : undefined}>
          {tampered.status === "done" && (tampered.accepted ? t("verify.pq.tamperAccepted") : t("verify.pq.tamperRejected"))}
          {tampered.status === "error" && t("verify.pq.error")}
        </p>
      </div>
      <ExplorerNote />
    </div>
  );
}

/** "Post-quantum signatures, re-checked in your browser": the section under the lookup on Verify. */
export function PqRecheck() {
  const { t } = useI18n();
  const { state, reload } = useLoad("pq", () => recheck());
  const [tampered, setTampered] = useState<Tampered>({ status: "idle" });
  const onTamper = () => {
    if (state.status !== "ready" || !state.value.checks[0]) return;
    setTampered({ status: "running" });
    tamperedCheck(state.value.checks[0]).then(
      (accepted) => setTampered({ status: "done", accepted }),
      () => setTampered({ status: "error" }),
    );
  };
  return (
    <section className="verify pq" aria-labelledby="pq-title" aria-busy={state.status === "loading"}>
      <h2 id="pq-title">{t("verify.pq.title")}</h2>
      <p className="lede">{t("verify.pq.lede")}</p>
      {state.status === "loading" && <p className="records-status">{t("verify.pq.loading")}</p>}
      {state.status === "error" && (
        <div className="records-status" role="alert">
          <p>{t("verify.pq.error")}</p>
          <button type="button" className="button" onClick={reload}>
            {t("registry.retry")}
          </button>
        </div>
      )}
      {state.status === "ready" && <PqRecheckView result={state.value} tampered={tampered} onTamper={onTamper} />}
    </section>
  );
}
