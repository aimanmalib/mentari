import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="intro">
      <h1>{t("notFound.title")}</h1>
      <p>
        <Link className="button" href={routes.registry}>
          {t("notFound.back")}
        </Link>
      </p>
    </div>
  );
}
