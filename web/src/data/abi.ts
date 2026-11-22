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
