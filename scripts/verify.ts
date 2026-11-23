/**
 * verify: check the testnet record from public endpoints only. No keys, no accounts file, no contract build.
 *
 *   pnpm verify            read both ledgers and print every check; exit 0 only when none fails
 *   pnpm verify --record   also write the summary to evidence/verify.json
 *
 * For every retirement on the EVM side it reads the Native receipt and compares sender, note and amount. It checks
 * minted - retired = supply, that the retirements add up to the retired total, and that each case recorded in
 * evidence/testnet.json ended the way it says: case A succeeded and added a receipt, the others reverted and left
 * the receipts book unchanged. When evidence/live.json exists it also reads back every transaction the public Try it
 * page sent in that record.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evmToQor } from "@qorechain/sdk";
import { bookReader } from "./src/book.js";
import { liveChecks, type LiveRecord } from "./src/live.js";
import { loadAppConfig } from "./src/config.js";
import { writeEvidence } from "./src/evidence.js";
import { mentariReader } from "./src/mentari-reader.js";
import { publicClient } from "./src/rpc.js";
import { formatReport, runVerify, summarise, type RecordedCase, type RecordedEntry } from "./src/verify.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CONCURRENCY = 4;

async function main(): Promise<void> {
  const app = loadAppConfig() as ReturnType<typeof loadAppConfig> & { native: { receiptsBook: string } };
  const testnet = JSON.parse(readFileSync(join(repoRoot, "evidence", "testnet.json"), "utf8")) as { cases: (RecordedCase | RecordedEntry)[] };
  const pub = publicClient(app.network.evmRpc, app.network.evmChainId);
  const book = bookReader({ rest: app.network.rest, book: app.native.receiptsBook });
  const mentariNative = evmToQor(app.contracts.mentari);

  console.log(`Mentari ${app.contracts.mentari} (${mentariNative})`);
  console.log(`EVM ${app.network.evmRpc} · REST ${app.network.rest}\n`);
  const checks = await runVerify(mentariReader(pub, app.contracts.mentari), book, {
    mentari: app.contracts.mentari,
    atomicityProbe: app.contracts.atomicityProbe,
    mentariNative,
    receiptsBook: app.native.receiptsBook,
    cases: testnet.cases,
    concurrency: CONCURRENCY,
  });
  const livePath = join(repoRoot, "evidence", "live.json");
  if (existsSync(livePath)) {
    const live = JSON.parse(readFileSync(livePath, "utf8")) as LiveRecord;
    const evm = mentariReader(pub, app.contracts.mentari);
    checks.push(...(await liveChecks(evm, book, live, [app.contracts.mentari, app.contracts.atomicityProbe])));
  }
  console.log(formatReport(checks));

  const summary = summarise(checks);
  if (process.argv.includes("--record")) {
    const block = await pub.getBlockNumber();
    writeEvidence(join(repoRoot, "evidence", "verify.json"), {
      readAt: new Date().toISOString(),
      evmRpc: app.network.evmRpc,
      rest: app.network.rest,
      evmBlock: Number(block),
      ...summary,
      checkList: checks,
    });
    console.log("wrote evidence/verify.json");
  }
  process.exitCode = summary.failed === 0 && summary.passed > 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error(`verify: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
