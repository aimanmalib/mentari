import { useCallback, useEffect, useState } from "react";
import { siteConfig } from "../config.js";
import { dataMode, readers, type Readers } from "./load.js";

export const siteMode = dataMode(siteConfig, import.meta.env.VITE_MENTARI_DATA);

let shared: Promise<Readers> | null = null;

/** One set of readers for the whole visit, so viem and the endpoints are set up once. */
export function getReaders(): Promise<Readers> {
  shared ??= readers(siteConfig, siteMode).catch((err: unknown) => {
    shared = null;
    throw err;
  });
  return shared;
}

export type Loaded<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; value: T } | { status: "error" };

/**
 * Runs `load` with the shared readers whenever `key` changes; a null key means there is nothing to load yet.
 * A result that arrives after the key changed is dropped.
 */
export function useLoad<T>(key: string | null, load: (r: Readers) => Promise<T>): { state: Loaded<T>; reload(): void } {
  const [state, setState] = useState<Loaded<T>>({ status: key === null ? "idle" : "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    getReaders()
      .then(load)
      .then(
        (value) => live && setState({ status: "ready", value }),
        () => live && setState({ status: "error" }),
      );
    return () => {
      live = false;
    };
    // `load` is rebuilt on each render; `key` names what it loads.
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, reload };
}
