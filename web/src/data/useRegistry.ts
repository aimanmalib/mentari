import { useCallback, useEffect, useRef, useState } from "react";
import { siteConfig } from "../config.js";
import { dataMode, loadRegistry } from "./load.js";
import type { RegistrySnapshot } from "./types.js";

export type RegistryState =
  | { status: "loading" }
  | { status: "ready"; snapshot: RegistrySnapshot; refreshing: boolean }
  | { status: "error"; snapshot: RegistrySnapshot | null };

const mode = dataMode(siteConfig, import.meta.env.VITE_MENTARI_DATA);

/** Reads the registry, then again every `refreshSeconds` while the tab is visible. */
export function useRegistry(): { state: RegistryState; reload(): void } {
  const [state, setState] = useState<RegistryState>({ status: "loading" });
  const last = useRef<RegistrySnapshot | null>(null);
  const busy = useRef(false);

  const reload = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    if (last.current) setState({ status: "ready", snapshot: last.current, refreshing: true });
    loadRegistry(siteConfig, mode)
      .then((snapshot) => {
        last.current = snapshot;
        setState({ status: "ready", snapshot, refreshing: false });
      })
      .catch(() => setState({ status: "error", snapshot: last.current }))
      .finally(() => {
        busy.current = false;
      });
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, siteConfig.refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [reload]);

  return { state, reload };
}
