import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";

/** A rising sun on a horizon: the name Mentari means "sun". */
export function SunMark() {
  return (
    <svg className="sun-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M6 22a10 10 0 0 1 20 0z" fill="var(--noon)" />
      <path d="M3 22h26" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 26h16" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" opacity=".45" />
    </svg>
  );
}

export function Header({ path }: { path: string }) {
  const { t, locale, setLocale } = useI18n();
  const nav = [
    { href: routes.registry, label: t("nav.registry") },
    { href: routes.how, label: t("nav.how") },
  ];
  return (
    <header className="site-header">
      <a className="skip" href="#main">
        {t("nav.skip")}
      </a>
      <div className="bar">
        <Link className="wordmark" href={routes.registry} aria-label="Mentari">
          <SunMark />
          <span>Mentari</span>
        </Link>
        <nav className="nav" aria-label={t("nav.label")}>
          {nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={path === item.href ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="lang" role="group" aria-label={t("nav.language")}>
          {siteConfig.locales.map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={locale === code}
              title={t(`nav.${code}`)}
              onClick={() => setLocale(code)}
            >
              {code === "ms" ? "BM" : code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <SunMark />
      <p>{t("footer.entry")}</p>
      <p>{t("footer.testnet")}</p>
    </footer>
  );
}

/** Says where the numbers on the page come from: sample data, or testnet with the read time. */
export function SourceNotice({ source, readAt }: { source: "live" | "sample"; readAt: number }) {
  const { t, dateTime } = useI18n();
  return (
    <p className={`source source-${source}`} role="note">
      {source === "sample" ? t("data.sample") : t("data.live", { time: dateTime(readAt) })}
    </p>
  );
}

export function SimulatedTag() {
  const { t } = useI18n();
  return <span className="sim-tag">{t("data.simulated")}</span>;
}
