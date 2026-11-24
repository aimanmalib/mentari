import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { siteConfig } from "../config.js";
import { shorten } from "../data/address.js";
import { explorer } from "../data/explorer.js";
import { useI18n } from "../i18n/I18n.js";
import { Link, routes } from "../router.js";
import { useWalletActions, type WalletResult } from "./useWalletActions.js";

const links = explorer(siteConfig.explorer);

function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono" href={links.tx(hash)} target="_blank" rel="noreferrer" title={hash}>
      {shorten(hash, 10, 6)}
    </a>
  );
}

function Result({ result }: { result: WalletResult }) {
  const { t, num } = useI18n();
  const wh = num(siteConfig.demoGrantWh);
  switch (result.kind) {
    case "granted":
      return (
        <p className="wallet-ok">
          {t("wallet.grantSent", { wh: num(result.wh) })} <TxLink hash={result.hash} />
        </p>
      );
    case "grant-refused":
      return (
        <p className="wallet-problem">
          {result.reason === "not-quantum-ready" ? t("wallet.problem.not-quantum-ready") : t(`tryit.reason.${result.reason}`)}
        </p>
      );
    case "key-registered":
      return (
        <p className="wallet-ok">
          {t("wallet.keyRegistered")} <TxLink hash={result.hash} /> <span className="wallet-note">{t("records.explorerNote")}</span>
        </p>
      );
    case "retired":
      return (
        <p className="wallet-ok">
          {t(result.lane === "native" ? "wallet.retiredNative" : "wallet.retired")} <TxLink hash={result.hash} />
          {result.n !== null && (
            <>
              {" · "}
              <Link href={`${routes.verify}?n=${result.n}`}>{t("wallet.retiredN", { n: num(result.n) })}</Link>
            </>
          )}
          {result.shielded && <>. {t("wallet.shielded")}</>}
          {result.lane === "native" && <span className="wallet-note"> {t("records.explorerNote")}</span>}
        </p>
      );
    case "problem":
      return (
        <p className="wallet-problem">
          {t(`wallet.problem.${result.problem}`, { wh })} {result.hash && <TxLink hash={result.hash} />}
        </p>
      );
  }
}

/** The connected part: who you are, whether the contract will pay you, and the steps (a key first, when it is missing). */
function Connected() {
  const { t, num } = useI18n();
  const { disconnect } = useDisconnect();
  const w = useWalletActions();
  const value = (v: string | null) => (w.contract === null ? t("wallet.unknown") : w.reading ? t("wallet.loading") : (v ?? t("wallet.unknown")));
  const readyText = w.ready === null ? null : w.ready ? t("wallet.readyYes") : t(w.lane === "native" ? "wallet.readyNoNative" : "wallet.readyNo");
  const enough = w.balance !== null && w.balance >= BigInt(siteConfig.demoRetireWh);
  // QoreX registers the key before its first Native transaction, so the page can offer that step itself.
  const needsKey = w.ready === false && w.lane === "native" && w.contract !== null;
  return (
    <>
      <dl className="wallet-facts" aria-label={t("wallet.factsLabel")}>
        <div>
          <dt>{t("wallet.evmAddress")}</dt>
          <dd className="mono" title={w.address}>{w.address ? shorten(w.address, 8, 6) : t("wallet.loading")}</dd>
        </div>
        <div>
          <dt>{t("wallet.nativeAddress")}</dt>
          <dd className="mono" title={w.nativeAddress ?? undefined}>{w.nativeAddress ? shorten(w.nativeAddress, 9, 6) : t("wallet.loading")}</dd>
        </div>
        <div>
          <dt>{t("wallet.ready")}</dt>
          <dd>{value(readyText)}</dd>
        </div>
        <div>
          <dt>{t("wallet.balance")}</dt>
          <dd>{value(w.balance === null ? null : t("unit.wh", { value: num(Number(w.balance)) }))}</dd>
        </div>
      </dl>
      {w.lane === "native" && <p className="wallet-note">{t("wallet.nativeAccount")}</p>}
      {w.contract === null && <p className="wallet-note">{t("wallet.notDeployed")}</p>}
      {needsKey && <p className="wallet-note">{t("wallet.keyHint", { uqor: siteConfig.wallet.keySetupUqor })}</p>}
      <div className="wallet-actions">
        {needsKey && (
          <button type="button" className="button button-solid" onClick={w.registerKey} disabled={w.busy !== null}>
            {w.busy === "key" ? t("wallet.retireSending") : t("wallet.registerKey")}
          </button>
        )}
        <button type="button" className="button" onClick={w.grant} disabled={w.contract === null || !w.address || w.busy !== null || w.ready === false}>
          {w.busy === "grant" ? t("wallet.grantSending") : t("wallet.grant", { wh: num(siteConfig.demoGrantWh) })}
        </button>
        <button type="button" className="button button-solid" onClick={w.retire} disabled={w.contract === null || !w.address || w.busy !== null || !enough}>
          {w.busy === "retire" ? t("wallet.retireSending") : t("wallet.retire", { wh: num(siteConfig.demoRetireWh) })}
        </button>
        <button type="button" className="wallet-disconnect" onClick={() => disconnect()}>
          {t("wallet.disconnect")}
        </button>
      </div>
      <div className="wallet-out" aria-live="polite">
        {w.result && <Result result={w.result} />}
      </div>
    </>
  );
}

export function WalletCard() {
  const { t, num } = useI18n();
  const { address, chainId, status } = useAccount();
  const { switchChain } = useSwitchChain();
  let body;
  if (status === "connected" && address && chainId !== siteConfig.evmChainId) {
    body = (
      <div className="wallet-actions">
        <p className="wallet-problem">{t("wallet.wrongNetwork")}</p>
        <button type="button" className="button" onClick={() => switchChain({ chainId: siteConfig.evmChainId })}>
          {t("wallet.switch")}
        </button>
      </div>
    );
  } else if (status === "connected" && address) {
    body = <Connected />;
  } else {
    body = (
      <ConnectButton.Custom>
        {({ openConnectModal, connectModalOpen }) => (
          <div className="wallet-actions">
            <button type="button" className="button button-solid" onClick={openConnectModal} disabled={connectModalOpen || status === "connecting"}>
              {status === "connecting" || status === "reconnecting" ? t("wallet.connecting") : t("wallet.connect")}
            </button>
          </div>
        )}
      </ConnectButton.Custom>
    );
  }
  return (
    <section className="wallet" aria-labelledby="wallet-title">
      <div className="wallet-head">
        <p className="wallet-preview">{t("wallet.preview")}</p>
        <h2 id="wallet-title">{t("wallet.title")}</h2>
        <p>{t("wallet.lede", { wh: num(siteConfig.demoGrantWh) })}</p>
        <p className="wallet-note">{t("wallet.honest")}</p>
      </div>
      <div className="wallet-body">{body}</div>
    </section>
  );
}
