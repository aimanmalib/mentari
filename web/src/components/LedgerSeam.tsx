import { shorten } from "../data/address.js";
import type { RegistryState } from "../data/useRegistry.js";
import type { Agreement, RegistrySnapshot } from "../data/types.js";
import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";

type Verdict = "agree" | "disagree" | "empty" | "checking" | "error";

function verdictOf(state: RegistryState): Verdict {
  if (state.status === "loading") return "checking";
  if (state.status === "error") return "error";
  return state.snapshot.agreement.state;
}

export function Seal({ verdict, className = "" }: { verdict: Verdict; className?: string }) {
  return (
    <svg className={`seal seal-${verdict} ${className}`.trim()} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" className="seal-ring" />
      {verdict === "agree" && <path d="M19 33l9 9 17-19" className="seal-mark" />}
      {(verdict === "disagree" || verdict === "error") && <path d="M23 23l18 18M41 23L23 41" className="seal-mark" />}
      {verdict === "empty" && <path d="M20 32h24" className="seal-mark" />}
    </svg>
  );
}

function detail(agreement: Agreement, t: ReturnType<typeof useI18n>["t"]): string {
  switch (agreement.state) {
    case "agree":
      return t("registry.agreeDetail", { checked: agreement.checked, total: agreement.total });
    case "disagree":
      return t("registry.disagreeDetail", { failed: agreement.failed.length, checked: agreement.checked });
    case "empty":
      return t("registry.emptyDetail");
  }
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The two ledgers side by side, joined by the result of checking one against the other. */
export function LedgerSeam({ state, onRetry }: { state: RegistryState; onRetry(): void }) {
  const { t, num } = useI18n();
  const verdict = verdictOf(state);
  const snap: RegistrySnapshot | null = state.status === "loading" ? null : state.snapshot;
  const wh = (v: bigint | undefined) => (v === undefined ? "–" : t("unit.wh", { value: num(v) }));
  const matched = snap ? snap.pairs.filter((p) => p.ok).length : undefined;
  const latest = snap?.pairs[0];

  let title: string;
  let text: string;
  if (verdict === "checking") [title, text] = [t("registry.checking"), ""];
  else if (verdict === "error") [title, text] = [t("registry.error"), t("registry.errorDetail", { seconds: siteConfig.refreshSeconds })];
  else [title, text] = [t(`registry.${verdict}`), detail(snap!.agreement, t)];

  return (
    <section className="seam" aria-labelledby="seam-verdict" aria-busy={verdict === "checking"}>
      <div className="lane lane-evm">
        <h2>
          {t("registry.evm")}
          <small>{t("registry.evmSub")}</small>
        </h2>
        <dl>
          <Figure label={t("registry.minted")} value={wh(snap?.totals.minted)} />
          <Figure label={t("registry.retired")} value={wh(snap?.totals.retired)} />
          <Figure label={t("registry.supply")} value={wh(snap?.totals.supply)} />
          <Figure label={t("registry.retirements")} value={snap ? num(snap.retirementsCount) : "–"} />
        </dl>
        {snap && <code title={snap.contract}>{shorten(snap.contract, 8, 6)}</code>}
      </div>

      <div className={`verdict verdict-${verdict}`}>
        <Seal verdict={verdict} />
        <p id="seam-verdict" className="verdict-title" aria-live="polite">
          {title}
        </p>
        {text && <p className="verdict-text">{text}</p>}
        {verdict === "disagree" && snap?.agreement.state === "disagree" && (
          <ul className="verdict-list">
            {snap.agreement.failed.map((p) => (
              <li key={p.n}>
                #{p.n}: {p.problems.map((code) => t(`registry.problem.${code}`)).join(", ")}
              </li>
            ))}
          </ul>
        )}
        {verdict === "error" && (
          <button type="button" className="button" onClick={onRetry}>
            {t("registry.retry")}
          </button>
        )}
      </div>

      <div className="lane lane-native">
        <h2>
          {t("registry.native")}
          <small>{t("registry.nativeSub")}</small>
        </h2>
        <dl>
          <Figure label={t("registry.matched")} value={matched === undefined ? "–" : `${num(matched)} / ${num(snap!.pairs.length)}`} />
          <Figure label={t("registry.latestReceipt")} value={latest ? `#${num(latest.receiptId)}` : snap ? t("registry.none") : "–"} />
        </dl>
        {snap && (
          <p className="lane-sender">
            {t("registry.sender")} <code title={snap.contractNative}>{shorten(snap.contractNative, 10, 6)}</code>
          </p>
        )}
      </div>
    </section>
  );
}
