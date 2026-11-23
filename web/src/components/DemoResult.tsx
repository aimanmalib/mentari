import { siteConfig } from "../config.js";
import { shorten } from "../data/address.js";
import type { Counts, DemoOutcome } from "../data/demo.js";
import type { EvidenceCase, Recheck } from "../data/evidence.js";
import { explorer } from "../data/explorer.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";
import { Seal } from "./LedgerSeam.js";
import { ChainLink } from "./RecordPair.js";

const links = explorer(siteConfig.explorer);

/** Before and after counts for both lanes: the change is the proof, so it is the largest thing in the panel. */
export function CountsBoard({ retirements, receipts }: { retirements: Counts | null; receipts: Counts | null }) {
  const { t, num } = useI18n();
  const lane = (kind: "evm" | "native", label: string, c: Counts | null) => {
    const delta = c ? c.after - c.before : null;
    return (
      <div className={`count count-${kind}`}>
        <p className="count-label">{label}</p>
        {c ? (
          <p className="count-values">
            <span>{num(c.before)}</span>
            <span className="count-arrow" aria-hidden="true">
              {" → "}
            </span>
            <span className="visually-hidden">{t("tryit.becomes")}</span>
            <strong>{num(c.after)}</strong>
          </p>
        ) : (
          <p className="count-values">–</p>
        )}
        {delta !== null && (
          <p className="count-delta">{delta === 0 ? t("tryit.unchanged") : t("tryit.changedBy", { delta: (delta > 0 ? "+" : "") + num(delta) })}</p>
        )}
      </div>
    );
  };
  return (
    <div className="counts">
      {lane("evm", t("tryit.evmCount"), retirements)}
      {lane("native", t("tryit.nativeCount"), receipts)}
    </div>
  );
}

/** What happened after a button press: a live transaction, or the recorded case when the demo could not send. */
export function DemoResult({
  outcome,
  recorded,
  recheck,
}: {
  outcome: DemoOutcome;
  recorded: EvidenceCase | null;
  recheck: Recheck | "checking" | null;
}) {
  const { t } = useI18n();
  if (outcome.kind === "sent") {
    const expectText = outcome.expect === "success" ? t("tryit.expectSuccess") : t("tryit.expectRevert");
    return (
      <div className={`demo-result ${outcome.asExpected ? "demo-ok" : "demo-bad"}`} role="status">
        <div className="demo-verdict">
          <Seal verdict={outcome.asExpected ? "agree" : "disagree"} className="seal-small" />
          <div>
            <p className="demo-title">{outcome.asExpected ? t("tryit.asExpected") : t("tryit.notExpected")}</p>
            <p>{expectText}</p>
          </div>
        </div>
        <CountsBoard retirements={outcome.retirements} receipts={outcome.receipts} />
        <p className="demo-tx">
          {outcome.txStatus === "success" ? t(`tryit.txSuccess.${outcome.tx.lane}`) : t(`tryit.txReverted.${outcome.tx.lane}`)}{" "}
          <ChainLink href={links.tx(outcome.tx.hash)} label={t("records.openTx", { hash: outcome.tx.hash })}>
            {shorten(outcome.tx.hash, 8, 6)}
          </ChainLink>
        </p>
        {outcome.tx.lane === "native" && <p className="demo-route">{t("tryit.nativeRoute")}</p>}
        {outcome.action === "retire" && (
          <Link className="button" href={routes.retirements}>
            {t("tryit.seeRetirements")}
          </Link>
        )}
      </div>
    );
  }

  const wait = outcome.retryAfterSeconds !== undefined ? Math.ceil(outcome.retryAfterSeconds / 60) : null;
  return (
    <div className="demo-result demo-fallback" role="status">
      <p className="demo-title">{t(`tryit.reason.${outcome.reason}`)}</p>
      {wait !== null && <p>{t("tryit.retryAfter", { minutes: wait })}</p>}
      {recorded ? (
        <>
          <p>{t("tryit.recordedIntro", { id: recorded.id })}</p>
          <CountsBoard retirements={recorded.retirements} receipts={recorded.receipts} />
          <p className="demo-tx">
            {t("tryit.recordedTx")}{" "}
            <ChainLink href={links.tx(recorded.evm_tx)} label={t("records.openTx", { hash: recorded.evm_tx })}>
              {shorten(recorded.evm_tx, 8, 6)}
            </ChainLink>
          </p>
          {recheck && <p className={`recheck recheck-${recheck}`}>{t(`tryit.recheck.${recheck}`)}</p>}
        </>
      ) : (
        <p>{t("tryit.noRecord")}</p>
      )}
    </div>
  );
}
