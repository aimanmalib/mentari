import { DEMO_ACTIONS, type DemoAction } from "./demo.js";

/**
 * A button on one page can ask the Try it page to press a demo button once it opens. The request rides in
 * history.state, never in the URL: a crawler or a shared link must not send a testnet transaction.
 */
const KEY = "mentariPress";

export function pressRequest(action: DemoAction): Record<string, DemoAction> {
  return { [KEY]: action };
}

/** The requested action, read once: the state is cleared so a reload or a back-forward visit does not press again. */
export function takePressRequest(h: Pick<History, "state" | "replaceState"> = history): DemoAction | null {
  const asked: unknown = (h.state as Record<string, unknown> | null)?.[KEY];
  if (typeof asked !== "string") return null;
  h.replaceState(null, "");
  return DEMO_ACTIONS.some((a) => a.action === asked) ? (asked as DemoAction) : null;
}
