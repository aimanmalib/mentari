import { useEffect, useState, type FormEvent } from "react";
import { SourceNotice } from "../components/Chrome.js";
import { PqRecheck } from "../components/PqRecheck.js";
import { VerifyResult } from "../components/VerifyReport.js";
import { siteConfig } from "../config.js";
import { parseVerifyQuery, verify, verifySearch, type VerifyQuery } from "../data/records.js";
import { siteMode, useLoad } from "../data/useReaders.js";
import { useI18n } from "../i18n/I18n.js";
import { navigate, routes, useSearch } from "../router.js";

function CopyLink() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(location.href).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button type="button" className="button button-quiet" onClick={copy}>
      <span aria-live="polite">{copied ? t("verify.copied") : t("verify.copy")}</span>
    </button>
  );
}

export function VerifyForm({ query }: { query: VerifyQuery | null }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<VerifyQuery["kind"]>(query?.kind ?? "n");
  const [value, setValue] = useState(query ? String(query.value) : "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!query) return;
    setKind(query.kind);
    setValue(String(query.value));
  }, [query?.kind, query?.value]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = parseVerifyQuery(`?${kind}=${encodeURIComponent(value.trim())}`);
    setInvalid(q === null);
    if (q) navigate(routes.verify + verifySearch(q), { keepScroll: true });
  };

  return (
    <form className="verify-form" onSubmit={submit} noValidate>
      <fieldset className="verify-kind">
        <legend>{t("verify.kindLabel")}</legend>
        {(["n", "receipt"] as const).map((k) => (
          <label key={k}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
            <span>{k === "n" ? t("verify.kindN") : t("verify.kindReceipt")}</span>
          </label>
        ))}
      </fieldset>
      <div className="verify-input">
        <label htmlFor="verify-value">{kind === "n" ? t("verify.inputN") : t("verify.inputReceipt")}</label>
        <div className="verify-row">
          <input
            id="verify-value"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? "verify-error" : undefined}
          />
          <button type="submit" className="button button-solid">
            {t("verify.submit")}
          </button>
        </div>
        {invalid && (
          <p id="verify-error" className="field-error">
            {t("verify.invalid")}
          </p>
        )}
      </div>
    </form>
  );
}

export function Verify() {
  const { t } = useI18n();
  const query = parseVerifyQuery(useSearch());
  const key = query ? verifySearch(query) : null;
  const { state, reload } = useLoad(key, (r) =>
    verify(r.evm, r.book, query!, { contract: r.contract, nativePrefix: siteConfig.nativePrefix }).then((report) => ({
      report,
      readAt: Date.now(),
    })),
  );
  return (
    <>
      <div className="intro">
        <h1>{t("verify.title")}</h1>
        <p className="lede">{t("verify.lede")}</p>
      </div>
      <section className="verify" aria-label={t("verify.title")} aria-busy={state.status === "loading"}>
        <VerifyForm query={query} />
        {state.status === "loading" && <p className="records-status">{t("verify.loading")}</p>}
        {state.status === "error" && (
          <div className="records-status" role="alert">
            <p>{t("registry.error")}</p>
            <button type="button" className="button" onClick={reload}>
              {t("registry.retry")}
            </button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <VerifyResult report={state.value.report} />
            <div className="verify-foot">
              <SourceNotice source={siteMode} readAt={state.value.readAt} />
              <CopyLink />
            </div>
          </>
        )}
      </section>
      {siteMode === "live" && <PqRecheck />}
    </>
  );
}
