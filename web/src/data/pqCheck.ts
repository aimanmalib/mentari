import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import type { SignatureJob } from "./readings.js";

/** ML-DSA-87 (FIPS 204) verification with `@noble/post-quantum`, on the calling thread. */
export function verifyNow(jobs: SignatureJob[]): boolean[] {
  return jobs.map((j) => {
    try {
      return ml_dsa87.verify(j.sig, j.msg, j.pub);
    } catch {
      return false;
    }
  });
}
