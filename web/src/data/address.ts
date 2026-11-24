import { bech32 } from "@scure/base";
import { getAddress, type Address } from "viem";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The Native (bech32) form of a 20-byte EVM address: same bytes, different encoding. */
export function evmToNative(address: string, prefix: string): string {
  if (!HEX_ADDRESS.test(address)) throw new Error(`not an EVM address: ${address}`);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = Number.parseInt(address.slice(2 + i * 2, 4 + i * 2), 16);
  return bech32.encode(prefix, bech32.toWords(bytes));
}

/** The EVM form of a Native (bech32) address: the address an EVM contract sees for a call that account signs. */
export function nativeToEvm(address: string): Address {
  const bytes = bech32.fromWords(bech32.decode(address as `${string}1${string}`).words);
  if (bytes.length !== 20) throw new Error(`not a 20-byte account address: ${address}`);
  return getAddress(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
}

/** `0x1234…abcd` for tables; the full value stays in the title attribute and links. */
export function shorten(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
