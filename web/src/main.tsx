import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/pages.css";
import "./styles/sections.css";
import "./styles/records.css";
import "./styles/verify.css";
import "./styles/try.css";
import "./styles/wallet.css";
import "./styles/home.css";
import "./styles/native.css";
import { App } from "./App.js";
import { I18nProvider } from "./i18n/I18n.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
