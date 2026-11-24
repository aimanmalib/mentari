import { HomeHero } from "../components/HomeHero.js";
import { HomeFaq, HomeSteps, LatestProof } from "../components/HomeStory.js";
import { LedgerSeam } from "../components/LedgerSeam.js";
import { SimulatedTag, SourceNotice } from "../components/Chrome.js";
import { SystemsTable } from "../components/SystemsTable.js";
import { useRegistry } from "../data/useRegistry.js";
import { useI18n } from "../i18n/I18n.js";

/** The home page: the claim and one action, the live registry as proof, then how it works and plain answers. */
export function Registry() {
  const { t } = useI18n();
  const { state, reload } = useRegistry();
  const snap = state.status === "loading" ? null : state.snapshot;
  return (
    <>
      <HomeHero />
      <section className="proof" aria-labelledby="proof-title">
        <div className="proof-head">
          <h2 id="proof-title">{t("home.proofTitle")}</h2>
          <p>{t("home.proofLede")}</p>
          <div className="intro-meta">
            <SimulatedTag />
            {snap && <SourceNotice source={snap.source} readAt={snap.readAt} />}
          </div>
        </div>
        <LedgerSeam state={state} onRetry={reload} />
        <LatestProof snapshot={snap} />
      </section>
      <HomeSteps />
      {snap && <SystemsTable systems={snap.systems} />}
      <HomeFaq />
    </>
  );
}
