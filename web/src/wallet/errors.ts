/**
 * Why a wallet request did not go through, in words the page can explain. QoreX answers unsupported EVM methods with
 * "QoreX: EVM method … not yet supported" (code 4200 in its announced version). A declined request is code 4001 in
 * EIP-1193 wallets, and "QoreX: signature rejected" (no code) in QoreX. QoreX refuses a Native transaction from an
 * account the chain has never seen with "QoreX: account … does not exist on … yet. Fund it first."
 */
export type WalletProblem = "declined" | "unsupported" | "not-quantum-ready" | "insufficient" | "unfunded" | "failed";

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
}

/** The error and every `cause` below it (viem and wagmi wrap the wallet's answer several levels deep). */
function chain(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let e: unknown = err;
  while (typeof e === "object" && e !== null && out.length < 10) {
    out.push(e as ErrorLike);
    e = (e as ErrorLike).cause;
  }
  return out;
}

export function classifyWalletError(err: unknown): WalletProblem {
  const links = chain(err);
  const codes = links.map((l) => l.code);
  const text = links
    .flatMap((l) => [l.message, l.shortMessage, l.details])
    .filter((t): t is string => typeof t === "string")
    .join("\n");
  if (codes.includes(4001) || /\brejected\b|declined/i.test(text)) return "declined";
  if (codes.includes(4200) || /not yet supported|method not supported|does not support|QOREX_NOT_SUPPORTED_YET/i.test(text)) return "unsupported";
  if (/NotQuantumReady/.test(text)) return "not-quantum-ready";
  if (/InsufficientBalance/.test(text)) return "insufficient";
  if (/does not exist on \S+ yet|insufficient funds/i.test(text)) return "unfunded";
  return "failed";
}
