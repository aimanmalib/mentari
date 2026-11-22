import { SimulatedTag } from "../components/Chrome.js";
import { Diagram } from "../components/Diagram.js";
import { shorten } from "../data/address.js";
import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";

const STEPS = ["step1", "step2", "step3", "step4", "step5"] as const;
const LIMITS = ["limit1", "limit2", "limit3", "limit4", "limit5"] as const;

export function HowItWorks() {
  const { t } = useI18n();
  const vars = { bridge: shorten(siteConfig.bridge, 4, 4), n: siteConfig.agreeCheckLatest };
  return (
    <>
      <div className="intro">
        <h1>{t("how.title")}</h1>
        <p className="lede">{t("how.lede")}</p>
      </div>

      <Diagram />

      <section className="prose" aria-labelledby="steps-title">
        <h2 id="steps-title">{t("how.stepsTitle")}</h2>
        <ol className="steps">
          {STEPS.map((key) => (
            <li key={key}>{t(`how.${key}`, vars)}</li>
          ))}
        </ol>
        <p className="fail-line">{t("how.fail")}</p>
      </section>

      <section className="prose" aria-labelledby="note-title">
        <h2 id="note-title">{t("how.noteTitle")}</h2>
        <pre className="note-sample">
          <code>MTR1 n=&lt;n&gt; wh=&lt;wh&gt; by=0x&lt;holder&gt; m=&lt;memo&gt;</code>
        </pre>
        <p>{t("how.noteBody")}</p>
      </section>

      <section className="prose" aria-labelledby="keys-title">
        <h2 id="keys-title">{t("how.keysTitle")}</h2>
        <p>{t("how.keysBody")}</p>
      </section>

      <section className="prose limits" aria-labelledby="limits-title">
        <div className="systems-head">
          <h2 id="limits-title">{t("how.limitsTitle")}</h2>
          <SimulatedTag />
        </div>
        <ul>
          {LIMITS.map((key) => (
            <li key={key}>{t(`how.${key}`, vars)}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
