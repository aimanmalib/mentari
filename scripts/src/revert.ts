import { BaseError, ContractFunctionRevertedError, decodeErrorResult, parseAbi, type Hex } from "viem";

const ERROR_STRING = parseAbi(["error Error(string)"]);

/** Bytes that hold a Solidity `Error(string)` become that string; anything else stays as hex. */
function readable(arg: unknown): string {
  if (typeof arg === "bigint" || typeof arg === "number" || typeof arg === "boolean") return String(arg);
  if (typeof arg === "string" && /^0x08c379a0/i.test(arg)) {
    try {
      const { args } = decodeErrorResult({ abi: ERROR_STRING, data: arg as Hex });
      return JSON.stringify(args[0]);
    } catch {
      return arg;
    }
  }
  return typeof arg === "string" ? arg : JSON.stringify(arg);
}

/**
 * The contract error inside a viem error, written as `Name(arg, ...)`, with a bridge refusal reason decoded to its
 * text: `BridgeCallFailed("cross-VM bridge call refused: ... is not allowlisted")`. Undefined when the error is not a
 * contract revert (network failure, out of gas, an error the ABI does not name).
 */
export function describeRevert(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return undefined;
  const name = revert.data?.errorName;
  if (name) return `${name}(${(revert.data?.args ?? []).map(readable).join(", ")})`;
  return revert.reason ? `Error(${JSON.stringify(revert.reason)})` : undefined;
}
