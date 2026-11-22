# Security policy

Mentari runs on the QoreChain Diana testnet only. Its certificates and test QOR have no value, but I still want to hear
about anything that breaks the rules the contracts promise.

## Reporting

Please do not open a public issue. Use
[private vulnerability reporting](https://github.com/aimanmalib/mentari/security/advisories/new); it reaches only the
maintainer. Say what you found, how to reproduce it, and what it lets an attacker do. I aim to answer within 7 days.

## In scope

- `contracts/src/`: minting without a valid ML-DSA-87 signature, replaying a signature, minting beyond the capacity
  limit, moving certificates to an account without a post-quantum key, a retirement on one ledger without the other,
  or a memo that changes the Native message.
- `server/src/`: reaching hosts or paths outside the read-only proxy allowlist, getting around the demo rate limits, or
  forging the client IP.
- Anything in the repository or its history that looks like a secret.

The threat model is in [`docs/threat-model.md`](docs/threat-model.md).

## Out of scope

- The QoreChain chain, the Cross-VM bridge and the shared `qday-receipts` contract. Report those to QoreChain.
- The simulated meter producing numbers that are not real sunshine. That is by design.
- Denial of service against the demo host.

## Supported versions

Only the latest commit on `main`. The testnet contracts cannot be upgraded; a fix means a new deployment, recorded in
[`CHANGELOG.md`](CHANGELOG.md) and a decision record.
