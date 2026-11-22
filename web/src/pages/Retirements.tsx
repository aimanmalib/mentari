import { SourceNotice } from "../components/Chrome.js";
import { RecordPair } from "../components/RecordPair.js";
import { siteConfig } from "../config.js";
import { readRetirementsPage, type RetirementsPage } from "../data/records.js";
import { useLoad, siteMode } from "../data/useReaders.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes, useSearch } from "../router.js";

/** `?from=<n>` starts the list at retirement n; anything else starts at the newest. */
export function fromParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("from");
  return raw !== null && /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

export function RetirementsList({ page }: { page: RetirementsPage }) {
  const { t, num } = useI18n();
  if (page.total === 0) {
    return (
      <div className="records-empty">
        <p>{t("retirements.empty")}</p>
        <Link className="button" href={routes.try}>
          {t("retirements.emptyAction")}
        </Link>
      </div>
    );
  }
  const first = page.records[0]?.retirement.n ?? 0;
  const last = page.records.at(-1)?.retirement.n ?? 0;
  return (
    <>
      <div className="records-head" aria-hidden="true">
        <span>{t("registry.evm")}</span>
        <span>{t("registry.native")}</span>
      </div>
      <ol className="records" aria-label={t("retirements.listLabel")}>
        {page.records.map((record) => (
          <li key={record.retirement.n}>
            <RecordPair record={record} />
          </li>
        ))}
      </ol>
      <nav className="records-pager" aria-label={t("retirements.pagerLabel")}>
        <p>{t("retirements.showing", { first: num(first), last: num(last), total: num(page.total) })}</p>
        {first < page.total && (
          <Link className="button" href={routes.retirements}>
            {t("retirements.newest")}
          </Link>
        )}
        {page.olderFrom !== null && (
          <Link className="button" href={`${routes.retirements}?from=${page.olderFrom}`}>
            {t("retirements.older")}
          </Link>
        )}
      </nav>
    </>
  );
}

export function Retirements() {
  const { t } = useI18n();
  const from = fromParam(useSearch());
  const { state, reload } = useLoad(`from:${from ?? "top"}`, (r) =>
    readRetirementsPage(r.evm, r.book, {
      contract: r.contract,
      nativePrefix: siteConfig.nativePrefix,
      pageSize: siteConfig.retirementsPageSize,
      from,
    }).then((page) => ({ page, readAt: Date.now() })),
  );
  return (
    <>
      <div className="intro">
        <h1>{t("retirements.title")}</h1>
        <p className="lede">{t("retirements.lede")}</p>
        {state.status === "ready" && (
          <div className="intro-meta">
            <SourceNotice source={siteMode} readAt={state.value.readAt} />
          </div>
        )}
      </div>
      <section className="records-wrap" aria-busy={state.status === "loading"} aria-label={t("retirements.title")}>
        {state.status === "loading" && <p className="records-status">{t("retirements.loading")}</p>}
        {state.status === "error" && (
          <div className="records-status" role="alert">
            <p>{t("registry.error")}</p>
            <button type="button" className="button" onClick={reload}>
              {t("registry.retry")}
            </button>
          </div>
        )}
        {state.status === "ready" && <RetirementsList page={state.value.page} />}
      </section>
    </>
  );
}
