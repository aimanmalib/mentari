/** The read-only part of the Mentari ABI the site needs. Kept in sync with contracts/src/Mentari.sol by test. */
export const mentariReadAbi = [
  {
    type: "function",
    name: "totals",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "minted_", type: "uint256" },
      { name: "retired_", type: "uint256" },
      { name: "supply", type: "uint256" },
    ],
  },
  { type: "function", name: "retirementsCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "retirement",
    stateMutability: "view",
    inputs: [{ name: "n", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "holder", type: "address" },
          { name: "wh", type: "uint64" },
          { name: "receiptId", type: "uint64" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "system",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "meter", type: "address" },
          { name: "producer", type: "address" },
          { name: "capacityW", type: "uint32" },
          { name: "firstDay", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "maxWh",
    stateMutability: "view",
    inputs: [{ name: "capacityW", type: "uint32" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

/** `Retired` event: the site finds the EVM transaction of retirement n by its indexed `n`. Kept in sync by test. */
export const retiredEvent = {
  type: "event",
  name: "Retired",
  inputs: [
    { name: "n", type: "uint256", indexed: true },
    { name: "holder", type: "address", indexed: true },
    { name: "wh", type: "uint256", indexed: false },
    { name: "receiptId", type: "uint64", indexed: true },
    { name: "memo", type: "string", indexed: false },
  ],
} as const;

/** What the wallet path calls: the visitor's balance, the receiver rule and `retire`. Kept in sync by test. */
export const mentariWalletAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isQuantumReady",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "retire",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wh", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    outputs: [
      { name: "n", type: "uint256" },
      { name: "receiptId", type: "uint64" },
    ],
  },
  { type: "error", name: "ZeroAmount", inputs: [] },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  { type: "error", name: "NotQuantumReady", inputs: [{ name: "account", type: "address" }] },
] as const;
