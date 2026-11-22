import type { Page, Route } from "@playwright/test";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  encodeFunctionResult,
  keccak256,
  parseTransaction,
  type Hex,
} from "viem";
import app from "../../config/app.json" with { type: "json" };
import { mentariWalletAbi, retiredEvent } from "../src/data/abi.js";
import fixture from "./fixture.json" with { type: "json" };

/** A sent transaction the fake node has seen, decoded. */
export interface SentTx {
  hash: Hex;
  to: string | undefined;
  call: { functionName: string; args: readonly unknown[] };
}

/**
 * A stand-in for the testnet EVM JSON-RPC endpoint, answering what the page and the wallet mock ask: the Mentari
 * reads, `retire` (simulated and sent), and receipts. Nothing leaves the test machine.
 */
export class FakeChain {
  balances = new Map<string, bigint>();
  quantumReady = true;
  nextRetirement = 7;
  readonly sent: SentTx[] = [];
  readonly #receipts = new Map<string, { status: "0x1" | "0x0"; logs: unknown[]; from: string }>();

  constructor(readonly contract = fixture.contract.toLowerCase()) {}

  balance(account: string): bigint {
    return this.balances.get(account.toLowerCase()) ?? 0n;
  }

  /** The demo account's transfer, as the server would have sent it. Returns its hash. */
  grant(to: string, wh: bigint): Hex {
    this.balances.set(to.toLowerCase(), this.balance(to) + wh);
    const hash = keccak256(`0x${(this.#receipts.size + 1).toString(16).padStart(8, "0")}` as Hex);
    this.#receipts.set(hash, { status: "0x1", logs: [], from: "0x000000000000000000000000000000000000d3e7" });
    return hash;
  }

  async install(page: Page): Promise<void> {
    const rpc = app.network.evmRpc.replace(/\/$/, "");
    await page.route(`${rpc}/**`, (route) => this.#handle(route));
    await page.route(rpc, (route) => this.#handle(route));
  }

  async #handle(route: Route): Promise<void> {
    const body = route.request().postDataJSON() as Rpc | Rpc[];
    const answer = Array.isArray(body) ? body.map((r) => this.#answer(r)) : this.#answer(body);
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, json: answer });
  }

  #answer(req: Rpc): unknown {
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    const p = req.params ?? [];
    switch (req.method) {
      case "eth_chainId":
        return ok(`0x${app.network.evmChainId.toString(16)}`);
      case "eth_blockNumber":
        return ok("0x10");
      case "eth_getBlockByNumber":
        return ok(BLOCK);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return ok("0x3b9aca00");
      case "eth_estimateGas":
        return ok("0x493e0");
      case "eth_getTransactionCount":
        return ok(`0x${this.sent.length.toString(16)}`);
      case "eth_call":
        return this.#call(req, p[0] as { from?: string; to?: string; data: Hex });
      case "eth_sendRawTransaction":
        return ok(this.#send(p[0] as Hex));
      case "eth_getTransactionReceipt":
        return ok(this.#receipt(p[0] as string));
      default:
        return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `fake chain: ${req.method} not handled` } };
    }
  }

  #call(req: Rpc, tx: { from?: string; to?: string; data: Hex }): unknown {
    const { functionName, args } = decodeFunctionData({ abi: mentariWalletAbi, data: tx.data });
    const result = (data: Hex) => ({ jsonrpc: "2.0", id: req.id, result: data });
    if (functionName === "balanceOf") {
      return result(encodeFunctionResult({ abi: mentariWalletAbi, functionName, result: this.balance(args[0]) }));
    }
    if (functionName === "isQuantumReady") {
      return result(encodeFunctionResult({ abi: mentariWalletAbi, functionName, result: this.quantumReady }));
    }
    const [wh] = args as readonly [bigint, string];
    const have = this.balance(tx.from ?? "");
    if (have < wh) {
      const data = encodeErrorResult({ abi: mentariWalletAbi, errorName: "InsufficientBalance", args: [have, wh] });
      return { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted", data } };
    }
    return result(encodeFunctionResult({ abi: mentariWalletAbi, functionName: "retire", result: [BigInt(this.nextRetirement), 900n] }));
  }

  #send(raw: Hex): Hex {
    const tx = parseTransaction(raw);
    const hash = keccak256(raw);
    const call = decodeFunctionData({ abi: mentariWalletAbi, data: tx.data! });
    this.sent.push({ hash, to: tx.to ?? undefined, call });
    const [wh, memo] = call.args as readonly [bigint, string];
    const n = BigInt(this.nextRetirement++);
    const topics = encodeEventTopics({ abi: [retiredEvent], eventName: "Retired", args: { n, holder: HOLDER, receiptId: 900n } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [wh, memo]);
    this.#receipts.set(hash, { status: "0x1", from: HOLDER, logs: [{ address: this.contract, topics, data, ...LOG_PLACE, transactionHash: hash }] });
    return hash;
  }

  #receipt(hash: string): unknown {
    const r = this.#receipts.get(hash);
    if (!r) return null;
    return {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash: BLOCK.hash,
      blockNumber: BLOCK.number,
      from: r.from,
      to: this.contract,
      cumulativeGasUsed: "0x30000",
      gasUsed: "0x30000",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: r.logs,
      logsBloom: `0x${"0".repeat(512)}`,
      status: r.status,
      type: "0x2",
    };
  }
}

interface Rpc {
  id: number;
  method: string;
  params?: unknown[];
}

/** The wallet mock's first account on its public test mnemonic. */
export const HOLDER = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const BLOCK = {
  number: "0x10",
  hash: `0x${"ab".repeat(32)}`,
  parentHash: `0x${"cd".repeat(32)}`,
  timestamp: "0x6740a000",
  baseFeePerGas: "0x3b9aca00",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  miner: "0x0000000000000000000000000000000000000000",
  transactions: [],
};

const LOG_PLACE = { blockHash: BLOCK.hash, blockNumber: BLOCK.number, logIndex: "0x0", transactionIndex: "0x0", removed: false };
