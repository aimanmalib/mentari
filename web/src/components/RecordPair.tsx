import { siteConfig } from "../config.js";
import { shorten } from "../data/address.js";
import { explorer } from "../data/explorer.js";
import type { RetirementRecord } from "../data/records.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";
import { Seal } from "./LedgerSeam.js";

const links = explorer(siteConfig.explorer);

/** A link to the public explorer, opened in a new tab. */
export function ChainLink({ href, children, label }: { href: string; children: string; label: string }) {
  return (
    <a className="chain-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      <code>{children}</code>
    </a>
  );
}

/** The explorer picks its network from its own setting and opens on mainnet; a link cannot choose testnet for it. */
export function ExplorerNote() {
  const { t } = useI18n();
  return <p className="explorer-note">{t("records.explorerNote")}</p>;
}

/** One retirement as a strip of the ledger seam: the EVM record on the left, its Native receipt on the right. */
export function RecordPair({ record, showVerify = true }: { record: RetirementRecord; showVerify?: boolean }) {
  const { t, num, dateParts } = useI18n();
  const { retirement: r, receipt, evmTx, check } = record;
  const when = dateParts(r.timestamp * 1000);
  const titleId = `pair-${r.n}`;
  return (
    <article className={`pair ${check.ok ? "pair-ok" : "pair-bad"}`} aria-labelledby={titleId}>
      <div className="pair-evm">
        <h3 id={titleId} className="pair-title">
          {t("records.retirement", { n: num(r.n) })}
        </h3>
        <p className="pair-amount">{t("unit.wh", { value: num(r.wh) })}</p>
        <dl className="pair-facts">
          <div>
            <dt>{t("records.holder")}</dt>
            <dd>
              <ChainLink href={links.address(r.holder)} label={t("records.openAddress", { address: r.holder })}>
                {shorten(r.holder)}
              </ChainLink>
            </dd>
          </div>
          <div>
            <dt>{t("records.time")}</dt>
            <dd>
              <time className="pair-time" dateTime={new Date(r.timestamp * 1000).toISOString()}>
                <span>{when.date}</span> <span>{when.time}</span>
              </time>
            </dd>
          </div>
          <div>
            <dt>{t("records.evmTx")}</dt>
            <dd>
              {evmTx ? (
                <ChainLink href={links.tx(evmTx)} label={t("records.openTx", { hash: evmTx })}>
                  {shorten(evmTx, 8, 6)}
                </ChainLink>
              ) : (
                <span className="pair-missing">{t("records.txUnknown")}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="pair-seam">
        <Seal verdict={check.ok ? "agree" : "disagree"} className="seal-small" />
        <p className="pair-verdict">{check.ok ? t("records.match") : t("records.mismatch")}</p>
        {!check.ok && <p className="pair-problems">{check.problems.map((code) => t(`registry.problem.${code}`)).join(", ")}</p>}
      </div>

      <div className="pair-native">
        <p className="pair-title">{t("records.receipt", { id: num(r.receiptId) })}</p>
        {receipt ? (
          <>
            <p className="pair-note">
              <code>{receipt.note}</code>
            </p>
            <dl className="pair-facts">
              <div>
                <dt>{t("registry.sender")}</dt>
                <dd>
                  <code title={receipt.sender}>{shorten(receipt.sender, 10, 6)}</code>
                </dd>
              </div>
              <div>
                <dt>{t("records.height")}</dt>
                <dd>
                  <ChainLink href={links.block(receipt.height)} label={t("records.openBlock", { height: receipt.height })}>
                    {num(receipt.height)}
                  </ChainLink>
                </dd>
              </div>
              <div>
                <dt>{t("records.nativeTx")}</dt>
                <dd>
                  <ChainLink href={links.receiptTx(receipt.id)} label={t("records.openReceiptTx", { id: receipt.id })}>
                    {t("records.nativeTxView")}
                  </ChainLink>
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="pair-missing">{t("records.noReceipt")}</p>
        )}
        {showVerify && (
          <Link className="pair-verify" href={`${routes.verify}?n=${r.n}`}>
            {t("records.verifyThis")}
          </Link>
        )}
      </div>
    </article>
  );
}
