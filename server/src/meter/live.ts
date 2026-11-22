import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  attestDays,
  readSystem,
  type MeterRun,
  type PqcSigner,
  type SystemPlan,
  type Wallet,
} from "../../../scripts/src/chain.js";
import { signMessage, type MeterConfig } from "../../../scripts/src/meter.js";
import { mentariMeterAbi } from "./abi.js";
import { unconfiguredMeter, type DailyJob } from "./daily.js";
import { readMeterKeys, type MeterKeys } from "./keys.js";

/**
 * The live daily meter job: attest the finished days the chain has not seen, with each meter's ML-DSA-87 key.
 * It reuses the chain driver of the scripts (decision 0012), which reads the chain before it sends, so a second
 * run on the same day sends nothing.
 */

/** Where the contract lives (`config/app.json`). */
export interface MeterChain {
  evmRpc: string;
  evmChainId: number;
  /** Empty until the contract is deployed. */
  mentari: string;
}

/** Signs as a meter with that meter's key. An account with no key is an error that names the account only. */
export function meterSigner(meters: ReadonlyMap<Address, Uint8Array>): PqcSigner {
  return (account, message) => {
    const key = meters.get(getAddress(account));
    if (!key) throw new Error(`no meter key for ${getAddress(account)}`);
    return signMessage(key, message);
  };
}

/** Each configured system with the meter and producer the chain registered for it. */
export async function plansFromChain(
  run: Pick<MeterRun, "pub" | "mentari" | "abi">,
  cfg: MeterConfig,
): Promise<SystemPlan[]> {
  const plans: SystemPlan[] = [];
  for (const s of cfg.systems) {
    const onChain = await readSystem(run, s.id);
    if (!onChain) throw new Error(`system ${s.id} is not registered`);
    plans.push({ ...s, meter: getAddress(onChain.meter), producer: getAddress(onChain.producer) });
  }
  return plans;
}

/**
 * The job over a ready chain connection. Before anything is sent it checks that a key exists for every
 * registered meter, so a missing key stops the run instead of attesting some systems and not others.
 */
export function chainMeterJob(opts: {
  cfg: MeterConfig;
  run: MeterRun;
  meters: ReadonlySet<Address>;
  /** Finished days to look back over; the server uses 1 (yesterday). */
  windowDays: number;
}): DailyJob {
  const { cfg, run, meters, windowDays } = opts;
  return {
    ready: () => true,
    run: async () => {
      const plans = await plansFromChain(run, cfg);
      for (const p of plans) {
        if (!meters.has(p.meter)) throw new Error(`no meter key for system ${p.id} (${p.meter})`);
      }
      const sent = await attestDays(run, cfg, plans, windowDays);
      return sent.length;
    },
  };
}

/**
 * The job the server runs. It stays off (and says why in the log) until the contract address is set and the
 * key file exists. A key file that is there but wrong is logged once and also leaves the run off, so the site
 * and the demo keep serving.
 */
export function liveMeterJob(opts: {
  cfg: MeterConfig;
  chain: MeterChain;
  keysDir: string | undefined;
  windowDays: number;
  log?: ((line: string) => void) | undefined;
}): DailyJob {
  const log = opts.log ?? ((line: string) => console.log(line));
  if (!isAddress(opts.chain.mentari)) return unconfiguredMeter;
  let keys: MeterKeys | null;
  try {
    keys = readMeterKeys(opts.keysDir);
  } catch (err) {
    log(`daily meter keys: ${(err as Error).message}`);
    return unconfiguredMeter;
  }
  if (!keys) return unconfiguredMeter;

  const chain = defineChain({
    id: opts.chain.evmChainId,
    name: "qorechain",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [opts.chain.evmRpc] } },
  });
  const transport = http(opts.chain.evmRpc);
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const wallet = createWalletClient({ chain, transport, account: privateKeyToAccount(keys.sender) }) as Wallet;
  const run: MeterRun = {
    pub,
    wallet,
    mentari: getAddress(opts.chain.mentari),
    abi: mentariMeterAbi,
    sign: meterSigner(keys.meters),
    log: (line) => log(`daily meter: ${line}`),
  };
  return chainMeterJob({ cfg: opts.cfg, run, meters: new Set(keys.meters.keys()), windowDays: opts.windowDays });
}
