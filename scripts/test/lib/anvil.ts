import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { loadArtifact, type PqcSigner, type Wallet } from "../../src/chain.js";

/**
 * A local anvil node on chain id 9800 with the test precompile (`contracts/test/mocks/MockPqc.sol`) placed
 * at the two post-quantum precompile addresses. No key material: anvil's own unlocked accounts send the
 * transactions, and the precompile accepts a stand-in signature (keccak256 of key and message, padded to
 * the ML-DSA-87 signature length). Real ML-DSA-87 signing is tested in meter.test.ts.
 */

export const VERIFY: Address = "0x0000000000000000000000000000000000000a01";
export const KEYS: Address = "0x0000000000000000000000000000000000000a02";
const SIGNATURE_LENGTH = 4627;
const PUBKEY_LENGTH = 2592;

export interface LocalChain {
  pub: PublicClient;
  /** Unlocked anvil accounts. */
  accounts: Address[];
  wallet(account: Address): Wallet;
  /** Registers a proven ML-DSA-87 key for `account` in the test precompile. */
  makeQuantumReady(account: Address): Promise<void>;
  sign: PqcSigner;
  stop(): void;
}

function findAnvil(): string {
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".foundry", "bin")];
  for (const d of dirs) if (d && existsSync(join(d, "anvil"))) return join(d, "anvil");
  throw new Error("anvil not found; install Foundry (scripts/gerbang-ujian.sh does)");
}

function waitForPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`anvil did not start: ${out}`)), 20_000);
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString();
      const m = out.match(/Listening on [\d.]+:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`anvil exited ${code}: ${out}`));
    });
  });
}

/** A fixed 2592-byte stand-in public key per account. */
export function testPubkey(account: Address): Hex {
  const unit = account.slice(2).toLowerCase();
  return `0x${unit.repeat(Math.ceil((PUBKEY_LENGTH * 2) / unit.length)).slice(0, PUBKEY_LENGTH * 2)}`;
}

/** The signature MockPqc accepts: keccak256(abi.encode(pubkey, message)) then zero bytes. */
export function testSignature(pubkey: Hex, message: Uint8Array): Hex {
  const h = keccak256(encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [pubkey, toHexBytes(message)]));
  return `${h}${"00".repeat(SIGNATURE_LENGTH - 32)}`;
}

function toHexBytes(b: Uint8Array): Hex {
  return `0x${Buffer.from(b).toString("hex")}`;
}

export async function startAnvil(chainId = 9800): Promise<LocalChain> {
  const child = spawn(findAnvil(), ["--port", "0", "--chain-id", String(chainId)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let port: number;
  try {
    port = await waitForPort(child);
  } catch (err) {
    child.kill();
    throw err;
  }
  const chain = defineChain({
    id: chainId,
    name: "local",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } },
  });
  const transport = http(`http://127.0.0.1:${port}`);
  const pub = createPublicClient({ chain, transport }) as PublicClient;
  const test = createTestClient({ chain, transport, mode: "anvil" });
  const accounts = (await createWalletClient({ chain, transport }).getAddresses()).map((a) => getAddress(a));
  const wallet = (account: Address) => createWalletClient({ chain, transport, account }) as Wallet;

  const mock = loadArtifact("MockPqc");
  const runtime = (await deployedCode(pub, wallet(accounts[0]!), mock)) as Hex;
  await test.setCode({ address: VERIFY, bytecode: runtime });
  await test.setCode({ address: KEYS, bytecode: runtime });

  const makeQuantumReady = async (account: Address) => {
    const w = wallet(accounts[0]!);
    const tx = await w.writeContract({
      address: KEYS,
      abi: mock.abi,
      functionName: "setKey",
      args: [account, true, 1, testPubkey(account), true],
      account: w.account,
      chain: w.chain,
    });
    await pub.waitForTransactionReceipt({ hash: tx });
  };
  return {
    pub,
    accounts,
    wallet,
    makeQuantumReady,
    sign: (account, message) => testSignature(testPubkey(account), message),
    stop: () => child.kill(),
  };
}

/** Runtime code of an artifact, read back from a throwaway deployment. */
async function deployedCode(pub: PublicClient, w: Wallet, art: ReturnType<typeof loadArtifact>) {
  const tx = await w.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [], account: w.account, chain: w.chain });
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  return pub.getCode({ address: r.contractAddress! });
}
