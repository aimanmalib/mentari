/**
 * testnet: deploy Mentari and AtomicityProbe, register the simulated meters and backfill their readings.
 *
 *   pnpm testnet          run every step that is still missing, then write the addresses to config/app.json
 *                         and the meter and demo sender key files to MENTARI_SECRETS_DIR (when set)
 *   pnpm testnet --keys   only write the two key files to MENTARI_SECRETS_DIR; send nothing
 *
 * Accounts come from the shared accounts file (MENTARI_ACCOUNTS) by the roles in config/app.json. The
 * deployer pays gas. Each registration is signed with the registrar's ML-DSA-87 key and each reading with
 * its meter's key. Output is public data only: addresses, days, amounts and transaction hashes.
 *
 * Before the first run each account needs QOR, a registered ML-DSA-87 key, and the deployer an open EVM
 * window without a scope (a scoped window refuses contract creation).
 */
import { fileURLToPath } from "node:url";
import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { loadArtifact, type PqcSigner } from "./src/chain.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { loadMeterConfig, signMessage } from "./src/meter.js";
import { indexOf } from "./src/session.js";
import { setupTestnet, writeContractsConfig, writeDemoKey, writeMeterKeys, type ContractsConfig } from "./src/setup.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appJson = fileURLToPath(new URL("../config/app.json", import.meta.url));

export { indexOf };

async function main(): Promise<void> {
  const app = loadAppConfig() as AppConfig & {
    contracts: ContractsConfig;
    native: { receiptsBook: string };
  };
  const meters = loadMeterConfig();
  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const account = (role: string): Promise<UnifiedAccount> => deriveUnifiedAccount(mnemonic, indexOf(app, role));

  const deployer = await account("funder and deployer");
  const registrar = await account("registrar");
  const producer = await account("producer");
  const meterAccounts = await Promise.all(meters.systems.map((s) => account(`meter ${s.label}`)));
  const writeKeys = async (dir: string) => {
    writeMeterKeys(dir, repoRoot, {
      sender: registrar.privateKey as Hex,
      senderPqc: registrar.pqc,
      meters: meterAccounts.map((a) => ({ address: getAddress(a.evm), pqcSecretKey: a.pqc.secretKey })),
    });
    const demo = await account("demo sender");
    writeDemoKey(dir, repoRoot, demo.privateKey as Hex, demo.pqc);
    console.log("wrote the meter keys and demo sender key files to the key folder");
  };
  if (process.argv.includes("--keys")) {
    const dir = process.env.MENTARI_SECRETS_DIR;
    if (!dir) throw new Error("MENTARI_SECRETS_DIR is not set");
    return writeKeys(dir);
  }

  // Each signing account by its EVM address; the keys stay in this process.
  const pqcKeys = new Map<Address, Uint8Array>(
    [registrar, ...meterAccounts].map((a) => [getAddress(a.evm), a.pqc.secretKey]),
  );
  const sign: PqcSigner = (who, message) => {
    const key = pqcKeys.get(getAddress(who));
    if (!key) throw new Error(`no ML-DSA-87 key for ${who}`);
    return signMessage(key, message);
  };

  const chain = defineChain({
    id: app.network.evmChainId,
    name: app.network.chainId,
    nativeCurrency: { name: app.network.symbol, symbol: app.network.symbol, decimals: app.network.evmDecimals },
    rpcUrls: { default: { http: [app.network.evmRpc] } },
  });
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(deployer.privateKey as Hex) });
  if ((await pub.getChainId()) !== app.network.evmChainId) throw new Error("RPC answers with another chain id");

  const result = await setupTestnet({
    run: { pub, wallet, sign, log: (line) => console.log(line) },
    current: app.contracts,
    arts: { mentari: loadArtifact("Mentari"), probe: loadArtifact("AtomicityProbe") },
    receiptsBook: app.native.receiptsBook,
    registrar: getAddress(registrar.evm),
    cfg: meters,
    plans: meters.systems.map((s, i) => ({
      ...s,
      meter: getAddress(meterAccounts[i]!.evm),
      producer: getAddress(producer.evm),
    })),
  });
  for (const d of result.deployed) console.log(`deployed ${d.name} at ${d.address}: ${d.tx}`);
  console.log(`sent ${result.sent.length} meter transactions`);

  if (result.deployed.length > 0) {
    writeContractsConfig(appJson, result.contracts);
    console.log("wrote the contract addresses and deploy block to config/app.json");
  }
  const dir = process.env.MENTARI_SECRETS_DIR;
  if (dir) {
    await writeKeys(dir);
  } else {
    console.log("MENTARI_SECRETS_DIR is not set: no key files written");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(`testnet: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
