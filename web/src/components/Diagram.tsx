import { shorten } from "../data/address.js";
import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";

/**
 * One retirement as it crosses the two virtual machines. Built from HTML so the labels stay readable at every
 * width: three nodes in a row on wide screens, a column on phones.
 */
export function Diagram() {
  const { t } = useI18n();
  return (
    <figure className="diagram" aria-label={t("how.diagramLabel")}>
      <div className="diagram-frame">
        <p className="diagram-tx">{t("how.diagram.tx")}</p>
        <div className="diagram-row">
          <div className="dnode dnode-evm">
            <span className="dnode-vm">{t("how.diagram.evm")}</span>
            <strong>{t("how.diagram.contract")}</strong>
            <span className="dnode-act">{t("how.diagram.burn")}</span>
          </div>
          <div className="dlink" aria-hidden="true">
            <span className="dlink-out">{t("how.diagram.record")}</span>
            <span className="dlink-back">{t("how.diagram.reply")}</span>
          </div>
          <div className="dnode dnode-bridge">
            <span className="dnode-vm">{t("how.diagram.evm")} / {t("how.diagram.native")}</span>
            <strong>{t("how.diagram.bridge")}</strong>
            <code>{shorten(siteConfig.bridge, 4, 4)}</code>
          </div>
          <div className="dlink" aria-hidden="true">
            <span className="dlink-out">{t("how.diagram.record")}</span>
            <span className="dlink-back">{t("how.diagram.reply")}</span>
          </div>
          <div className="dnode dnode-native">
            <span className="dnode-vm">{t("how.diagram.native")}</span>
            <strong>{t("how.diagram.book")}</strong>
            <code>{shorten(siteConfig.receiptsBook, 7, 5)}</code>
          </div>
        </div>
      </div>
    </figure>
  );
}
