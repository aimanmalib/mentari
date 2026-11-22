# 0014. The live meter job, its key file, and a bundled server

Date: 2026-11-22. Status: accepted. Replaces the server build step of decision 0009.

## Context

Decision 0013 put the daily meter run in the server with an injected job that stays off. The live job needs three
things the server did not have: the chain driver from `scripts/src/chain.ts` (decision 0012), the `viem` and QoreChain
SDK packages it uses, and the meter keys. The image had no `node_modules`, and the Foundry build output is not in the
image, so the contract ABI is not there either.

## Decision

- `server/src/meter/live.ts` builds the job. It reads each configured system from the chain (meter and producer as
  registered), checks that a key exists for every meter before it sends anything, and calls `attestDays` with
  `daily.windowDays` from `config/meter.json` (1, so yesterday). The driver reads the chain first, so a second run on
  the same day sends nothing.
- Keys come from one file, `meter-keys.json`, in the read-only key folder (`MENTARI_SECRETS_DIR`). It holds an EVM key
  that only pays gas and one ML-DSA-87 secret key per meter address. `attest` checks the meter's signature, not the
  sender, so the gas account can be any funded account except the demo sender, which would race it for nonces.
  Errors about the file name the field, never the value. A missing file or an empty `contracts.mentari` leaves the run
  off; a broken file is logged once and also leaves it off, so the site and the demo keep serving.
- `server/src/meter/abi.ts` holds the part of the `Mentari` ABI the job calls plus every custom error.
  `server/test/meter-abi.test.ts` compares it with `contracts/out/Mentari.sol/Mentari.json`, struct field names
  included, so a contract change cannot drift past it.
- The server build is now esbuild (`server/package.json`): one ESM file, `server/dist/main.js`, with its packages and the
  driver inlined, and a `createRequire` banner for the CommonJS parts of the SDK. The run stage still has no
  `node_modules`. The image build installs `@mentari/scripts` as well, because the bundle imports from `scripts/src`.
  The test gate runs the server build, so a package that cannot be bundled fails there, not on deploy.

## Consequences

- The image grows by the bundle (about 6.5 MB). Startup reads one larger file.
- When the testnet run deploys the contract it writes `meter-keys.json` and sets `contracts.mentari`; a redeploy then
  turns the daily run on. Whether QoreChain needs an open EVM window for these calls is checked in that run.
- The meter keys sit next to the demo key on the host, outside the repository and the image (threat T11).

## How to undo

Remove `meter-keys.json` from the key folder or set `daily.enabled` to `false`: the run turns off. To go back to the
old build, restore `server/tsconfig.build.json`, set the build script to `tsc -p tsconfig.build.json`, drop the
`viem`, SDK and esbuild entries from `server/package.json` and the `@mentari/scripts` filter from the `Dockerfile`, and
pass `unconfiguredMeter` in `server/src/main.ts`.
