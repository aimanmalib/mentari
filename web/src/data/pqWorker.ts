/// <reference lib="webworker" />
import { verifyNow } from "./pqCheck.js";
import type { SignatureJob } from "./readings.js";

// Verifies the jobs it is sent and answers once; `browserVerifier` starts one worker per check.
self.onmessage = (e: MessageEvent<SignatureJob[]>) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(verifyNow(e.data));
};
