import { bech32 } from "@scure/base";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The Native (bech32) form of a 20-byte EVM address: same bytes, different encoding. */
export function evmToNative(address: string, prefix: string): string {
  if (!HEX_ADDRESS.test(address)) throw new Error(`not an EVM address: ${address}`);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = Number.parseInt(address.slice(2 + i * 2, 4 + i * 2), 16);
  return bech32.encode(prefix, bech32.toWords(bytes));
}

/** `0x1234…abcd` for tables; the full value stays in the title attribute and links. */
export function shorten(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
