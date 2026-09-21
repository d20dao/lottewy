# Lottewy V2 implementation

Direct contract access remains permissionless. The V2 consumer uses a UUPS proxy with a two-step owner role and explicit upgrade authority. Lottewy publication requires signed wallet authentication, ownership checks and JEV review. The interface is English. Turkish Markdown must never enter commits.

This repository does not implement x402 payments, subscriptions, entry payments, prize custody or mainnet operations. The separate agent API can use an explicitly authorized contract relayer; the site only reads its public result records.

## V2 governance and persistence

The proxy initializes ownership once and disables implementation initialization. Upgrades require the owner and retain the same D20 coordinator. Owner renunciation is disabled. Public verification and Worker reconciliation pin both proxy and implementation code and the ERC-1967 implementation slot; an upgrade requires reviewing and updating those pins. This contract is upgradeable, not immutable.

Direct `start` binds the caller. `startFor` checks an EIP-712 owner authorization bound to executor, proxy, chain, commitment, fee cap and deadline. `startSponsored` trusts an allowlisted service relayer to authenticate its payer offchain. None of these paths permits a second request for an existing owner/giveaway key. Coordinator expiry refunds go to the draw owner for direct/signed-intent requests, and to the native-fee payer for sponsored requests. API payment refunds are a separate service responsibility. Overpayment returns to the transaction payer.

V2 starts with a separate D1 database; V1 records and deployments are not migrated. Historical V1 vectors document the old deployment only. Large private archives and signed action payloads are stored in integrity-checked chunks in the same atomic batch as their references. One wallet can reserve only one unconfirmed draw at a time. Browser save retries preserve both giveaway identity and signed action identity after an uncertain response.

The website's signed action and recovery workflow supports direct wallet `start` calls only. Sponsored records are stored and reconciled by the separate agent service, including their explicit refund recipient. `/agent/:id` is a read-only viewer and never sends those records into the website's mutation or reconciliation routes. `startFor` is a contract primitive, not an enabled website workflow.

## Canonical serialization and selection

`shared/core.ts` is the versioned reference. Canonical prefixes: null `n`; boolean `t/f`; integer `i<decimal>;`; string `s<UTF8 byte length>:<value>`; array `a<count>:[...]`; object `o<count>:{...}`. Object keys use UTF-16 code-unit order. Floats and undefined are rejected. Entries use NFC normalization and trim; internal whitespace and order are preserved. Hashing uses Keccak-256.

Each private entry has a random 32-byte salt. Its commitment hashes `["lottewy-entry-v1", giveawayId, entryId, salt, raw]`. Public manifests bind ordered entry IDs, masked labels, commitments, rules, counts and versions. The manifest hash becomes the D20DAO client seed. Raw values and salts remain owner-only.

Selection hashes UTF-8 `lottewy-selection-v1` + bytes32 commitment + bytes32 word + uint256 big-endian counter. Rejection sampling avoids modulo bias; partial Fisher-Yates produces distinct entries. Winners precede ordered alternates. `docs/testnet-public-manifest.json` and `docs/testnet-e2e.json` preserve a real testnet vector.

## Authentication and consistency

SIWE challenges are short-lived and single-use. EOA signatures are checked locally; deployed ERC-1271 wallets use block-bound RPC verification. Undeployed wallets have no weaker fallback. Sessions use HttpOnly, SameSite=Strict cookies and Secure on HTTPS.

EIP-712 actions bind signer, action type, target, canonical payload hash, revision, nonce, timestamps and audience. D1 transactional batches couple mutation, nonce consumption, constraint guards and append-only journal writes. Repeated action IDs return the original result; changed payloads and stale revisions fail.

A durable reservation precedes submission. Timeout and RPC failure never unlock it. The consumer accepts one request per owner/giveaway and cannot rewrite commitments or results. Reconciliation checks successful receipts, emitter, owner, request, commitment and finality. Externally submitted permissionless requests restore and lock their exact matching revision; conflicting hashes enter reconciliation.

## Evidence scope

Public replay verifies entry IDs, not real-world identities or prize delivery. The independent verifier checks both pinned D20DAO implementations, request/consumer/receipt/block bindings, seed and VRF proof packet against the SDK and pinned public key. Epoch source attestations rely on the coordinator and registry's onchain verification; a full independent replay of those attestations is not claimed.

## Recovery

Callback retries deliver the same accepted word. Expiry refunds go to the original payer; failed transfers become coordinator refund credit. Consumer overpayment is returned immediately or recorded as separate withdrawable credit. Withdrawals follow checks-effects-interactions and reentrancy protection. Gas is not refunded.

V1 has no automatic new-word retry. EOA submissions bind a reserved sender nonce. A canonical successful zero-value same-nonce self transaction, or a canonical matching reverted start, releases the reservation only after inclusion in the explicit RPC finalized frontier and a check that no consumer draw exists. Attempt history and chain observations remain recorded. Smart-wallet and legacy reservations without a known nonce remain locked pending equivalent proof. Browser rejection and timeout alone never unlock anything. Real testnet cancellation evidence is preserved in `docs/testnet-cancellation.json`.

## Weighted selection and presentation

Optional public weights are integers from 1 to 1,000; at most 10,000 entries bounds the total to 10,000,000. Every weight is committed in the public manifest. `lottewy-weighted-reject-v2` uses domain-separated Keccak counter words, rejection sampling over remaining total weight, and a Fenwick tree for cumulative lookup and removal. Selecting an entry removes its entire weight. The v1 equal-chance engine remains unchanged for historical replay. Masking v2 uses English fallback entry labels while v1 manifests remain replayable.

The real weighted testnet request is 5258. Its immutable manifest and independently verified proof are in `docs/testnet-weighted-public-manifest.json` and `docs/testnet-weighted-e2e.json`.

Reveal styles are presentation-only and have no authority over selection, weights, raw words or commitments. A decorative wheel does not represent entry odds. All styles share the same completed result and can be skipped; reduced-motion mode reveals immediately.

## Sources

- SDK: `@d20dao/vrf-sdk@0.4.0`, protocol provenance commit `de5f82eb9fc749c80e83270f57cde9908ddcf1f3`. Compilation checks packaged Solidity hashes against PROTOCOL-PROVENANCE.
- https://github.com/d20dao/d20-sdk
- https://d20dao.org/llms-full.txt
- https://d20dao.org/deployments/arc-testnet.json
- https://docs.typesafe.ai/introduction/quickstart
- https://docs.typesafe.ai/api

Arc Testnet chain ID: 5042002. Deployment and end-to-end evidence are in `docs/lottewy-testnet.json` and `docs/testnet-e2e.json`. Only synthetic entries were used. JEV thresholds require further corpus calibration before production. Review manifests after upstream upgrades.

Active giveaway pages request serialized synchronization immediately and every three seconds after a response, pausing when hidden. Reconciliation uses per-record leases, immutable attempt identities and compare-and-set guards; every checked record advances the fair background queue, including empty draws and RPC failures. Arc finality is read through the finalized tag, with no fixed confirmation-depth delay or latest-block fallback.
