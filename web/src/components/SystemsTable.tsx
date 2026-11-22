import { shorten } from "../data/address.js";
import type { SystemInfo } from "../data/types.js";
import { formatTags } from "../i18n/core.js";
import { useI18n } from "../i18n/I18n.js";
import { SimulatedTag } from "./Chrome.js";

const DAY_MS = 86_400_000;

/** Registered solar systems. Every meter on this page is simulated, and the label says so on each row. */
export function SystemsTable({ systems }: { systems: SystemInfo[] }) {
  const { t, num, locale } = useI18n();
  const day = new Intl.DateTimeFormat(formatTags[locale] ?? locale, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <section className="systems" aria-labelledby="systems-title">
      <div className="systems-head">
        <h2 id="systems-title">{t("systems.title")}</h2>
        <SimulatedTag />
      </div>
      <p className="systems-note">{t("systems.note")}</p>
      {systems.length === 0 ? (
        <p className="empty">{t("systems.empty")}</p>
      ) : (
        <ul className="system-list">
          {systems.map((s) => (
            <li key={s.id} className="system">
              <h3>{t("systems.name", { label: s.label })}</h3>
              <dl>
                <div>
                  <dt>{t("systems.capacity")}</dt>
                  <dd>{t("unit.w", { value: num(s.capacityW) })}</dd>
                </div>
                <div>
                  <dt>{t("systems.dailyCap")}</dt>
                  <dd>{t("unit.wh", { value: num(s.maxWh) })}</dd>
                </div>
                <div>
                  <dt>{t("systems.since")}</dt>
                  <dd>{day.format(s.firstDay * DAY_MS)}</dd>
                </div>
                <div>
                  <dt>{t("systems.meter")}</dt>
                  <dd>
                    <code title={s.meter}>{shorten(s.meter)}</code>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
