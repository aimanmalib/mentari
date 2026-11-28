import poster from "../assets/mentari-cover.png";
import { siteConfig, type SiteConfig } from "../config.js";
import { pressRequest } from "../data/pressOnOpen.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, navigate, routes } from "../router.js";

/**
 * The cover art in a panel frame. With a video link in config it opens the video; without one it is a still. With a
 * video copy in config (decision 0032) the caption also offers the MP4 from this site, for when YouTube does not open.
 */
export function Poster({ video = siteConfig.links.video, copy = siteConfig.videoCopy }: { video?: string; copy?: SiteConfig["videoCopy"] }) {
  const { t, num } = useI18n();
  const image = <img src={poster} width={1920} height={1080} alt={t("home.posterAlt")} decoding="async" />;
  return (
    <figure className="poster">
      <div className="poster-frame">
        {video ? (
          <a className="poster-play" href={video} target="_blank" rel="noopener noreferrer">
            {image}
            <span className="poster-button">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
              {t("home.watch")}
            </span>
          </a>
        ) : (
          image
        )}
      </div>
      <figcaption>
        <span>{t("home.posterCaption")}</span>
        {copy.path ? (
          <a className="poster-copy" href={copy.path} download type="video/mp4">
            {t("home.videoCopy", { mb: num(Math.round(copy.bytes / 1_000_000)) })}
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** First screen: what Mentari is, one action that proves it, and the product in a frame. */
export function HomeHero() {
  const { t, num } = useI18n();
  const retire = () => navigate(routes.try, { state: pressRequest("retire") });
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-text">
        <h1 id="hero-title">{t("registry.title")}</h1>
        <p className="lede">{t("registry.lede")}</p>
        <div className="hero-actions">
          <button type="button" className="hero-cta" onClick={retire}>
            {t("home.cta", { wh: num(siteConfig.demoRetireWh) })}
          </button>
          <p className="hero-cta-sub">{t("home.ctaSub")}</p>
          <Link className="hero-how" href={routes.how}>
            {t("home.howLink")}
          </Link>
        </div>
      </div>
      <Poster />
    </section>
  );
}
