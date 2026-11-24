import { createPublicClient, decodeFunctionData, encodePacked, http, parseAbi, type Address, type Hex } from "viem";

/**
 * The in-browser post-quantum check on Verify (decision 0037). The server lists the newest meter readings the chain
 * accepted, as raw `attest` calldata. Everything else happens here: decode the reading, rebuild the bytes the meter
 * signed (`Mentari.attestMessage`), read the meter's ML-DSA-87 key from the chain's key registry, and verify.
 */

/** One accepted reading as `/api/readings` sends it. */
export interface ReadingTx {
  cosmosTx: string;
  height: number;
  calldata: string;
}

export interface Reading {
  cosmosTx: string;
  height: number;
  id: number;
  /** UTC day number (days since 1970-01-01). */
  day: number;
  wh: bigint;
  sig: Hex;
}

/** What the check reads from the chain. The live version wraps viem; tests pass a plain object. */
export interface ReadingChain {
  /** The meter address registered for system `id`, or null when the contract does not know it. */
  meterOf(id: number): Promise<string | null>;
  /** The meter's registered, possession-proven ML-DSA-87 public key, or null when it has none. */
  keyOf(account: string): Promise<Hex | null>;
  /** True when the contract recorded a reading for this system and day. */
  attested(id: number, day: number): Promise<boolean>;
}

export interface SignatureJob {
  sig: Uint8Array;
  msg: Uint8Array;
  pub: Uint8Array;
}

/** Checks ML-DSA-87 signatures; one answer per job, in order. */
export type Verifier = (jobs: SignatureJob[]) => Promise<boolean[]>;

export type SignatureResult = "valid" | "invalid" | "no-key";

export interface ReadingCheck {
  reading: Reading;
  meter: string | null;
  signature: SignatureResult;
  /** The contract recorded this reading, so the chain's own `pqcVerify` accepted the same signature. */
  chainAccepted: boolean;
  /** The browser and the chain reached the same answer. */
  agree: boolean;
}

const attestAbi = parseAbi(["function attest(uint32 id, uint32 day, uint64 wh, bytes sig)"]);
const readAbi = parseAbi([
  "struct System { address meter; address producer; uint32 capacityW; uint32 firstDay; }",
  "function system(uint32 id) view returns (System)",
  "function attested(uint32 id, uint32 day) view returns (bool)",
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);

/** The registry's `algorithmId` for ML-DSA-87 and the key length, as `contracts/src/lib/Pqc.sol` requires. */
export const ML_DSA_87 = 1;
export const PUBKEY_BYTES = 2592;

/** The reading inside one `attest` call, or null when the calldata is anything else. */
export function decodeReading(tx: ReadingTx): Reading | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: attestAbi, data: tx.calldata as Hex });
    if (functionName !== "attest") return null;
    const [id, day, wh, sig] = args;
    return { cosmosTx: tx.cosmosTx, height: tx.height, id, day, wh, sig };
  } catch {
    return null;
  }
}

/** The bytes a meter signs for one reading; the same as `Mentari.attestMessage(id, day, wh)` on chain. */
export function attestMessage(chainId: number, contract: string, r: Pick<Reading, "id" | "day" | "wh">): Hex {
  return encodePacked(
    ["string", "uint256", "address", "uint32", "uint32", "uint64"],
    ["Mentari:attest:v1", BigInt(chainId), contract as Address, r.id, r.day, r.wh],
  );
}

export function bytes(hex: Hex): Uint8Array {
  const clean = hex.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A copy of `sig` with one byte changed, for the "tampered copy" check. */
export function tamper(sig: Hex, index: number): Uint8Array {
  const out = bytes(sig);
  const i = Math.min(Math.max(0, index), out.length - 1);
  out[i] = (out[i] ?? 0) ^ 0x01;
  return out;
}

/** Decodes, rebuilds and verifies each reading, and reads whether the contract recorded it. */
export async function checkReadings(
  txs: ReadingTx[],
  chain: ReadingChain,
  verifier: Verifier,
  opts: { chainId: number; contract: string },
): Promise<ReadingCheck[]> {
  const readings = txs.flatMap((tx) => decodeReading(tx) ?? []);
  const facts = await Promise.all(
    readings.map(async (r) => {
      const [meter, chainAccepted] = await Promise.all([chain.meterOf(r.id), chain.attested(r.id, r.day)]);
      const key = meter ? await chain.keyOf(meter) : null;
      return { r, meter, chainAccepted, key };
    }),
  );
  const withKey = facts.filter((f) => f.key !== null);
  const answers = await verifier(
    withKey.map((f) => ({ sig: bytes(f.r.sig), msg: bytes(attestMessage(opts.chainId, opts.contract, f.r)), pub: bytes(f.key!) })),
  );
  return facts.map((f) => {
    const at = withKey.indexOf(f);
    const signature: SignatureResult = at === -1 ? "no-key" : answers[at] ? "valid" : "invalid";
    return { reading: f.r, meter: f.meter, signature, chainAccepted: f.chainAccepted, agree: (signature === "valid") === f.chainAccepted };
  });
}

export function summarise(checks: ReadingCheck[]): { total: number; valid: number; agree: boolean } {
  return {
    total: checks.length,
    valid: checks.filter((c) => c.signature === "valid").length,
    agree: checks.length > 0 && checks.every((c) => c.agree),
  };
}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The server's list of readings; anything but a well-formed list throws, so the page says it could not check. */
export async function fetchReadings(fetchFn: Fetch, url: string): Promise<ReadingTx[]> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`readings unavailable (HTTP ${res.status})`);
  const list = ((await res.json()) as { readings?: unknown } | null)?.readings;
  if (!Array.isArray(list)) throw new Error("readings unreadable");
  return list.filter(
    (x): x is ReadingTx =>
      typeof x === "object" && x !== null && typeof x.cosmosTx === "string" && typeof x.height === "number" && typeof x.calldata === "string",
  );
}

/** Live chain reads over the public EVM JSON-RPC endpoint. */
export function liveReadingChain(rpcUrl: string, contract: string, keyRegistry: string): ReadingChain {
  const c = createPublicClient({ transport: http(rpcUrl, { batch: true, retryCount: 1, timeout: 10_000 }) });
  const read = <T>(address: string, functionName: string, args: readonly unknown[]) =>
    c.readContract({ address: address as Address, abi: readAbi, functionName, args } as never) as Promise<T>;
  return {
    async meterOf(id) {
      try {
        return (await read<{ meter: string }>(contract, "system", [id])).meter;
      } catch (err) {
        if (err instanceof Error && /UnknownSystem|reverted/.test(err.message)) return null;
        throw err;
      }
    },
    async keyOf(account) {
      const [registered, algorithmId, pubkey, proven] = await read<readonly [boolean, number, Hex, boolean]>(
        keyRegistry,
        "pqcKeyStatus",
        [account],
      );
      return registered && proven && algorithmId === ML_DSA_87 && (pubkey.length - 2) / 2 === PUBKEY_BYTES ? pubkey : null;
    },
    attested: (id, day) => read<boolean>(contract, "attested", [id, day]),
  };
}
