import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DemoResult } from "../components/DemoResult.js";
import { siteConfig } from "../config.js";
import { DEMO_ACTIONS, knownFallback, readStatus, runDemo, type DemoAction, type DemoOutcome, type DemoStatus } from "../data/demo.js";
import { recheckCase, type EvidenceCase, type Recheck } from "../data/evidence.js";
import { evidenceCases } from "../data/evidenceSource.js";
import { takePressRequest } from "../data/pressOnOpen.js";
import { getReaders, siteMode } from "../data/useReaders.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";

// wagmi and RainbowKit load only when the page is shown, so the rest of the site stays light.
const WalletPanel = lazy(() => import("../wallet/WalletPanel.js"));

const FAILURES = DEMO_ACTIONS.filter((a) => a.expect === "revert");
const cases = evidenceCases(siteMode);
const browserFetch = (url: string, init?: RequestInit) => fetch(url, init);

/** One line under the guide: whether live sends are possible right now, and how many are left. */
export function DemoStatusLine({ status }: { status: DemoStatus | null | "loading" }) {
  const { t, num } = useI18n();
  let text: string;
  if (status === "loading") text = t("tryit.statusLoading");
  else if (status === null || !status.ready) text = t("tryit.statusOffline");
  else if (!status.enabled) text = t("tryit.statusDisabled");
  else text = t("tryit.statusLive", { today: num(status.remainingToday), you: num(status.remainingForYou) });
  const live = status !== "loading" && status !== null && status.ready && status.enabled;
  return <p className={`demo-status ${live ? "demo-status-live" : ""}`}>{text}</p>;
}

export function TryIt() {
  const { t, num } = useI18n();
  const [status, setStatus] = useState<DemoStatus | null | "loading">("loading");
  const [running, setRunning] = useState<DemoAction | null>(null);
  const [outcome, setOutcome] = useState<DemoOutcome | null>(null);
  const [recorded, setRecorded] = useState<EvidenceCase | null>(null);
  const [recheck, setRecheck] = useState<Recheck | "checking" | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(() => {
    readStatus(browserFetch, siteConfig.demoApi).then(setStatus);
  }, []);
  useEffect(refreshStatus, [refreshStatus]);

  const press = async (action: DemoAction) => {
    if (running) return;
    setRunning(action);
    setRecheck(null);
    const result = knownFallback(status, action) ?? (await runDemo(browserFetch, siteConfig.demoApi, action));
    const rec = result.kind === "fallback" ? (cases.find((c) => c.id === result.evidenceCase) ?? null) : null;
    setOutcome(result);
    setRecorded(rec);
    setRunning(null);
    refreshStatus();
    resultRef.current?.focus();
    if (rec) {
      setRecheck("checking");
      const readers = await getReaders().catch(() => null);
      setRecheck(await recheckCase(rec, readers ? readers.txStatus : null));
    }
  };

  // The home page's "Retire now" button asks for one press here; it runs once the status is known.
  useEffect(() => {
    if (status === "loading") return;
    const asked = takePressRequest();
    if (asked) void press(asked);
  }, [status]);

  const steps = [
    t("tryit.step1", { wh: num(siteConfig.demoRetireWh) }),
    t("tryit.step2"),
    t("tryit.step3"),
  ];

  return (
    <>
      <div className="intro">
        <h1>{t("tryit.title")}</h1>
        <p className="lede">{t("tryit.lede")}</p>
      </div>

      <section className="guide" aria-labelledby="guide-title">
        <h2 id="guide-title">{t("tryit.guideTitle")}</h2>
        <ol className="guide-steps">
          {steps.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
        <DemoStatusLine status={status} />
      </section>

      <section className="demo" aria-label={t("tryit.controlsLabel")}>
        <div className="demo-main">
          <button type="button" className="retire-now" onClick={() => press("retire")} disabled={running !== null}>
            <span>{running === "retire" ? t("tryit.sending") : t("tryit.retireNow")}</span>
            <small>{t("tryit.retireNowSub", { wh: num(siteConfig.demoRetireWh) })}</small>
          </button>
        </div>
        <div className="demo-fails">
          <h2>{t("tryit.failTitle")}</h2>
          <p>{t("tryit.failLede")}</p>
          <ul>
            {FAILURES.map((f) => (
              <li key={f.action}>
                <button type="button" className="fail-button" onClick={() => press(f.action)} disabled={running !== null}>
                  <span>{running === f.action ? t("tryit.sending") : t(`tryit.fail.${f.action}.label`)}</span>
                  <small>{t(`tryit.fail.${f.action}.what`)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div ref={resultRef} tabIndex={-1} className="demo-out" aria-live="polite">
        {outcome ? (
          <DemoResult outcome={outcome} recorded={recorded} recheck={recheck} />
        ) : (
          <p className="demo-idle">
            {t("tryit.idle")} <Link href={routes.verify}>{t("nav.verify")}</Link>
          </p>
        )}
      </div>

      <Suspense fallback={null}>
        <WalletPanel />
      </Suspense>
    </>
  );
}
