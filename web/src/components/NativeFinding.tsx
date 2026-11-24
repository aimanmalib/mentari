import { shorten } from "../data/address.js";
import { explorer } from "../data/explorer.js";
import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";
import { ExplorerNote } from "./RecordPair.js";

/**
 * Native → EVM → Native as one drawing. SVG, not CSS 3D: WebKit under Playwright does not paint CSS perspective.
 * The drawing is a column, so the same picture reads at 320 px and at 1440 px.
 */
export function NativeRouteDiagram() {
  const { t } = useI18n();
  const d = (key: string) => t(`how.native.d.${key}`);
  const node = (y: number, title: string, sub: string, tone: string, mono = false) => (
    <g className={`nr-node nr-node-${tone}`}>
      <rect x="56" y={y} width="248" height="64" rx="6" />
      <text x="72" y={y + 27} className="nr-title">
        {title}
      </text>
      <text x="72" y={y + 49} className={mono ? "nr-sub nr-mono" : "nr-sub"}>
        {sub}
      </text>
    </g>
  );
  const arrow = (y1: number, y2: number, label: string) => (
    <g className="nr-arrow">
      <line className="nr-halo" x1="88" y1={y1} x2="88" y2={y2 - 8} />
      <line x1="88" y1={y1} x2="88" y2={y2 - 8} />
      <path d={`M80 ${y2 - 10} L88 ${y2} L96 ${y2 - 10} Z`} />
      <text x="104" y={(y1 + y2) / 2 + 5} className="nr-mono">
        {label}
      </text>
    </g>
  );
  return (
    <figure className="native-route">
      <svg viewBox="0 0 320 452" role="img" aria-label={t("how.native.diagramLabel")}>
        <rect className="nr-frame" x="2" y="10" width="316" height="440" rx="18" />
        <text className="nr-frame-label" x="20" y="15">
          {d("tx")}
        </text>
        <rect className="nr-lane nr-lane-native" x="14" y="28" width="292" height="112" rx="10" />
        <rect className="nr-lane nr-lane-evm" x="14" y="172" width="292" height="122" rx="10" />
        <rect className="nr-lane nr-lane-native" x="14" y="326" width="292" height="112" rx="10" />
        <text className="nr-lane-label nr-on-native" x="26" y="48">
          {d("native")}
        </text>
        <text className="nr-lane-label nr-on-evm" x="26" y="192">
          {d("evm")}
        </text>
        <text className="nr-lane-label nr-on-native" x="26" y="346">
          {d("native")}
        </text>
        {node(60, d("account"), d("sign"), "native", true)}
        {arrow(124, 204, d("call"))}
        {node(204, d("contract"), d("burn"), "evm")}
        <text className="nr-window" x="296" y="286" textAnchor="end">
          {d("window")}
        </text>
        {arrow(268, 358, d("bridge"))}
        {node(358, d("book"), d("receipt"), "native")}
      </svg>
    </figure>
  );
}

/** The finding: the docs mark this direction as not yet tested on the live network; two transactions show it runs. */
export function NativeFinding() {
  const { t } = useI18n();
  const { docsUrl, caseTx, retireTx } = siteConfig.nativeFinding;
  const links = explorer(siteConfig.explorer);
  const proof = [
    { key: "caseLink", hash: caseTx },
    { key: "retireLink", hash: retireTx },
  ];
  return (
    <section className="native-finding" aria-labelledby="native-title">
      <div className="nf-text">
        <p className="nf-eyebrow">{t("how.native.eyebrow")}</p>
        <h2 id="native-title">{t("how.native.title")}</h2>
        <blockquote className="nf-quote" cite={docsUrl}>
          <p className="nf-quote-head" lang="en">{t("how.native.docsHeading")}</p>
          <p lang="en">“{t("how.native.docsQuote")}”</p>
          <footer>
            <a href={docsUrl} rel="noopener" target="_blank">
              {t("how.native.docsCite")}
            </a>
          </footer>
        </blockquote>
        <p>{t("how.native.body")}</p>
        <h3 className="nf-proof-title">{t("how.native.proofTitle")}</h3>
        <ul className="nf-proof">
          {proof.map(({ key, hash }) => (
            <li key={key}>
              <span>{t(`how.native.${key}`)}</span>
              <a
                href={links.tx(hash)}
                rel="noopener"
                target="_blank"
                aria-label={t("how.native.openLabel", { hash: shorten(hash, 8, 6) })}
              >
                <code>{shorten(hash, 8, 6)}</code>
              </a>
            </li>
          ))}
        </ul>
        <ExplorerNote />
      </div>
      <NativeRouteDiagram />
    </section>
  );
}
