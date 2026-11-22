import { LedgerSeam } from "../components/LedgerSeam.js";
import { SimulatedTag, SourceNotice } from "../components/Chrome.js";
import { SystemsTable } from "../components/SystemsTable.js";
import { useRegistry } from "../data/useRegistry.js";
import { useI18n } from "../i18n/I18n.js";

export function Registry() {
  const { t } = useI18n();
  const { state, reload } = useRegistry();
  const snap = state.status === "loading" ? null : state.snapshot;
  return (
    <>
      <div className="intro">
        <h1>{t("registry.title")}</h1>
        <p className="lede">{t("registry.lede")}</p>
        <div className="intro-meta">
          <SimulatedTag />
          {snap && <SourceNotice source={snap.source} readAt={snap.readAt} />}
        </div>
      </div>
      <LedgerSeam state={state} onRetry={reload} />
      {snap && <SystemsTable systems={snap.systems} />}
    </>
  );
}
