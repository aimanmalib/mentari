import { siteConfig } from "../config.js";
import { explorer } from "../data/explorer.js";
import type { RegistrySnapshot } from "../data/types.js";
import { useI18n } from "../i18n/I18n.js";
import { ExplorerNote } from "./RecordPair.js";

const links = explorer(siteConfig.explorer);
const STEPS = ["meter", "retire", "receipt"] as const;

/** The newest retirement and a link to the Native transaction that wrote its receipt. Nothing when none is read yet. */
export function LatestProof({ snapshot }: { snapshot: RegistrySnapshot | null }) {
  const { t, num } = useI18n();
  const latest = snapshot?.pairs[0];
  if (!latest) return null;
  return (
    <div className="latest">
      <p>
        {t("home.latest", { n: num(latest.n), id: num(latest.receiptId) })}{" "}
        <a
          className="latest-link"
          href={links.receiptTx(latest.receiptId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("home.latestLabel", { id: latest.receiptId })}
        >
          {t("home.latestLink")}
        </a>
      </p>
      <ExplorerNote />
    </div>
  );
}

/** The three things that happen in one retirement, in order. */
export function HomeSteps() {
  const { t } = useI18n();
  return (
    <section className="home-steps" aria-labelledby="steps-title">
      <h2 id="steps-title">{t("home.stepsTitle")}</h2>
      <ol>
        {STEPS.map((id) => (
          <li key={id} className={`step step-${id}`}>
            <h3>{t(`home.steps.${id}.title`)}</h3>
            <p>{t(`home.steps.${id}.text`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Plain answers to what a first-time visitor asks; the list of questions is in config. */
export function HomeFaq({ ids = siteConfig.home.faq }: { ids?: string[] }) {
  const { t } = useI18n();
  return (
    <section className="faq" aria-labelledby="faq-title">
      <h2 id="faq-title">{t("home.faqTitle")}</h2>
      <div className="faq-list">
        {ids.map((id) => (
          <details key={id}>
            <summary>{t(`home.faq.${id}.q`)}</summary>
            <p>{t(`home.faq.${id}.a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
