import { shorten } from "../data/address.js";
import type { VerifyCheck, VerifyReport } from "../data/records.js";
import { useI18n } from "../i18n/I18n.js";
import { Seal } from "./LedgerSeam.js";
import { ExplorerNote, RecordPair } from "./RecordPair.js";

const CHECK_KEYS: Record<VerifyCheck, string> = {
  "receipt-exists": "verify.check.receiptExists",
  "same-id": "verify.check.sameId",
  sender: "verify.check.sender",
  note: "verify.check.note",
};

/** The answer to one lookup: what was checked, each check's result, and the two records side by side. */
export function VerifyResult({ report }: { report: VerifyReport }) {
  const { t, num } = useI18n();
  const asked =
    report.query.kind === "n"
      ? t("verify.askedN", { n: num(report.query.value) })
      : t("verify.askedReceipt", { id: num(report.query.value) });

  if (report.state !== "checked") {
    let text: string;
    if (report.state === "not-found") text = report.query.kind === "n" ? t("verify.noRetirement") : t("verify.noReceipt");
    else if (report.state === "orphan") text = t("verify.orphan", { n: num(report.n) });
    else text = t("verify.notMentari", { sender: shorten(report.receipt.sender, 10, 6) });
    return (
      <div className={`verify-answer verify-${report.state === "orphan" ? "bad" : "none"}`} role="status">
        <Seal verdict={report.state === "orphan" ? "disagree" : "empty"} className="seal-small" />
        <div>
          <p className="verify-asked">{asked}</p>
          <p className="verify-title">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="verify-report">
      <div className={`verify-answer verify-${report.ok ? "ok" : "bad"}`} role="status">
        <Seal verdict={report.ok ? "agree" : "disagree"} className="seal-small" />
        <div>
          <p className="verify-asked">{asked}</p>
          <p className="verify-title">{report.ok ? t("verify.ok") : t("verify.bad")}</p>
        </div>
      </div>
      <ul className="verify-checks" aria-label={t("verify.checksLabel")}>
        {report.checks.map((c) => (
          <li key={c.code} className={c.ok ? "check-ok" : "check-bad"}>
            <span className="check-mark" aria-hidden="true">
              {c.ok ? "✓" : "✕"}
            </span>
            <span>
              {t(CHECK_KEYS[c.code])}
              <span className="visually-hidden">{c.ok ? t("verify.passed") : t("verify.failed")}</span>
            </span>
          </li>
        ))}
      </ul>
      <RecordPair record={report.record} showVerify={false} />
      <ExplorerNote />
    </div>
  );
}
