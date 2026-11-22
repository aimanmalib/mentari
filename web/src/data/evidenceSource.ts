import { parseEvidence, type EvidenceCase } from "./evidence.js";
import { sampleData, type DataMode } from "./load.js";

// `evidence/testnet.json` exists once the testnet cases are recorded. A glob, unlike an import, builds without it.
const recorded = import.meta.glob("../../../evidence/testnet.json", { eager: true, import: "default" });

/** Recorded cases for the mode: the testnet evidence in live mode, the labelled sample cases otherwise. */
export function evidenceCases(mode: DataMode): EvidenceCase[] {
  if (mode === "sample") return parseEvidence(sampleData.cases);
  return parseEvidence(Object.values(recorded)[0] ?? []);
}
