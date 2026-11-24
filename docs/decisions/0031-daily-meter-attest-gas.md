# 0031. Set the daily meter's attest gas from three measured Native calls

Date: 2026-11-24. Status: accepted. Follows decision 0026, which put the daily meter on the Native lane behind a
switch, and decision 0013, which added the daily job.

## Context

The meter switch `nativeRoute.meter` was turned on once cases E and F were recorded. The server ran the daily job when
it started on 24 November and sent `attest` for the two systems that had no reading for day 20780 (23 November); system
3 already had that day from case H step 1. Each call was one hybrid-signed `MsgCrossVMCall` from the meter sender, with
no EVM window, and each was accepted:

| Call | Cosmos transaction | Block | Gas used |
| --- | --- | --- | --- |
| Case H step 1, system 3 | `FC13A89597E46C3128D351B25C351461D2EC8B30A2D053017DFC6D7175AB2A3E` | 10637935 | 640,824 |
| Daily run, system 1 | `B9F8E8E674524472133356D3B81613198315EB5C4D37D0AEE01B799A7C545BD3` | 10638497 | 641,046 |
| Daily run, system 2 | `921B8E1804F6B28C3CB163E638E6B9D53D0C0521571F187CF7FC5E76C355F70D` | 10638500 | 641,121 |

The limit was 2,000,000, a guess made before any measurement. A Native call pays the whole limit at
`nativeLane.gasPriceUqor` (0.15 uqor), whatever it uses, so each attest paid 0.3 QOR.

## Decision

`nativeRoute.attestGas` is 900,000: the largest measured use plus about 40 percent. Each attest now pays 0.135 QOR,
and the three systems cost 0.405 QOR a day instead of 0.9 QOR.

## Consequences

- If an attest ever needs more than 900,000 gas it fails in its block. The daily job logs the failure and tries again
  after its retry delay with the same limit, so the fix is a config change and a deploy, not a wait.
- The day's readings for all three systems are on the testnet without an EVM window, so the daily meter keeps running
  after the scoped windows expire.

## How to undo

Set `nativeRoute.attestGas` back to `2000000` in `config/app.json` and deploy. To take the meter off the Native lane,
set `nativeRoute.meter` to `false`; it then needs a live EVM window for its sender.
