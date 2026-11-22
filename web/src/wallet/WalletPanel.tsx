import "@rainbow-me/rainbowkit/styles.css";
import { lightTheme, RainbowKitProvider, type Locale } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { siteConfig } from "../config.js";
import { useI18n } from "../i18n/I18n.js";
import { walletConfig } from "./setup.js";
import { WalletCard } from "./WalletCard.js";

/**
 * The wallet dialog in the site's colours and type, read from the design tokens. The overlay gets no backdrop
 * filter: a filter on an animated overlay can crash WebKit on iPhone.
 */
const base = lightTheme({ accentColor: "var(--silicon)", accentColorForeground: "var(--silicon-text)", borderRadius: "medium" });
const theme = { ...base, fonts: { body: "var(--font-body)" }, blurs: { ...base.blurs, modalOverlay: "none" } };

/**
 * "Retire from your own wallet" on the Try it page. Loaded on demand, so wagmi and RainbowKit stay out of the first
 * page load for visitors who never use a wallet.
 */
export default function WalletPanel() {
  const { t, locale } = useI18n();
  const [config] = useState(() => walletConfig(siteConfig, t("wallet.group")));
  const [queryClient] = useState(() => new QueryClient());
  const modalLocale = (siteConfig.wallet.modalLocales[locale] ?? siteConfig.wallet.modalLocales[siteConfig.defaultLocale]) as Locale;
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} locale={modalLocale} modalSize="compact">
          <WalletCard />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
