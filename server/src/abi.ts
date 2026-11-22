import { parseAbi } from "viem";

/**
 * The parts of the contract ABIs the server calls, plus every custom error so a refused call is reported by name.
 * The image does not carry the Foundry build output, so the server keeps these subsets;
 * `server/test/abi.test.ts` fails when one drifts from `contracts/out/`.
 */

const mentariErrors = [
  "error AlreadyAttested(uint32 id, uint32 day)",
  "error AmountTooLarge(uint256 wh)",
  "error BadMaxSunHours(uint16 value)",
  "error BadMemo()",
  "error BadReply()",
  "error BadSignature(address signer)",
  "error BadSignatureLength(uint256 length)",
  "error BridgeCallFailed(bytes reason)",
  "error BridgeNotActive()",
  "error BridgeReplyMalformed()",
  "error DayOutOfRange(uint32 day, uint32 firstDay, uint32 today)",
  "error EmptyReceiptsBook()",
  "error InsufficientBalance(uint256 balance, uint256 needed)",
  "error KeyNotProven(address account)",
  "error KeyNotRegistered(address account)",
  "error NotQuantumReady(address account)",
  "error PqcUnavailable()",
  "error ReceiptIdNotIncreasing(uint64 id, uint64 last)",
  "error Reentrancy()",
  "error SystemExists(uint32 id)",
  "error UnknownRetirement(uint256 n)",
  "error UnknownSystem(uint32 id)",
  "error WhOutOfRange(uint64 wh, uint64 max)",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error ZeroCapacity()",
] as const;

/** What the daily meter run calls on `Mentari`. */
export const mentariMeterAbi = parseAbi([
  "struct System { address meter; address producer; uint32 capacityW; uint32 firstDay; }",
  "function system(uint32 id) view returns (System)",
  "function nonce() view returns (uint256)",
  "function attested(uint32 id, uint32 day) view returns (bool)",
  "function attestMessage(uint32 id, uint32 day, uint64 wh) view returns (bytes)",
  "function attest(uint32 id, uint32 day, uint64 wh, bytes sig)",
  ...mentariErrors,
]);

/** What the demo sender calls on `Mentari`. */
export const mentariDemoAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function retirementsCount() view returns (uint256)",
  "function isQuantumReady(address account) view returns (bool)",
  "function transfer(address to, uint256 wh) returns (bool)",
  "function retire(uint256 wh, string memo) returns (uint256 n, uint64 receiptId)",
  ...mentariErrors,
]);

/** What the demo sender calls on the `AtomicityProbe` fixture (cases B, C and D). */
export const probeDemoAbi = parseAbi([
  "function recordThenRevert(string note)",
  "function nativeRefuses()",
  "function callTarget(string target, string note) returns (uint64 receiptId)",
  "error BadMemo()",
  "error BadReply()",
  "error BridgeCallFailed(bytes reason)",
  "error BridgeNotActive()",
  "error BridgeReplyMalformed()",
  "error EmptyReceiptsBook()",
  "error RevertedAfterNativeWrite(uint64 receiptId)",
]);
