import { parseAbi } from "viem";

/**
 * The part of the `Mentari` ABI the daily meter run calls, plus every custom error so a refused call is reported
 * by name. The image does not carry the Foundry build output, so the server keeps this subset;
 * `server/test/meter-abi.test.ts` fails when it drifts from `contracts/out/Mentari.sol/Mentari.json`.
 */
export const mentariMeterAbi = parseAbi([
  "struct System { address meter; address producer; uint32 capacityW; uint32 firstDay; }",
  "function system(uint32 id) view returns (System)",
  "function nonce() view returns (uint256)",
  "function attested(uint32 id, uint32 day) view returns (bool)",
  "function attestMessage(uint32 id, uint32 day, uint64 wh) view returns (bytes)",
  "function attest(uint32 id, uint32 day, uint64 wh, bytes sig)",
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
]);
