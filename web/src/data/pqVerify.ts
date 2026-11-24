import { verifyNow } from "./pqCheck.js";
import type { Verifier } from "./readings.js";

/**
 * Runs the checks in a Web Worker so the page stays responsive, one worker per call. Where workers are not
 * available (tests, very old browsers) the checks run on the page instead; the answer is the same.
 */
export const browserVerifier: Verifier = (jobs) => {
  if (typeof Worker === "undefined") return Promise.resolve(verifyNow(jobs));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pqWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<boolean[]>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "signature worker failed"));
    };
    worker.postMessage(jobs);
  });
};
