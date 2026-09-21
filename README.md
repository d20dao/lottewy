# Lottewy

Verifiable giveaways for Discord communities, Web3 projects and public participant lists. Lottewy runs on **Arc Mainnet**, using D20DAO randomness and deterministic winner selection.

- [Website](https://lottewy.com)
- [Agent guide](https://lottewy.com/llms.txt)
- [Separate x402 API](https://github.com/d20dao/lottewy-x402)
- [Support](mailto:hello@lottewy.com)

## What it does

Paste entries or import CSV/spreadsheet columns, choose winners and alternates, review the masked public list, then sign and save. The organizer pays Arc gas in native USDC and the D20DAO service fee when starting the draw. Lottewy adds no website platform fee and does not hold or distribute prizes.

Equal chances are the default. Optional positive integer weights use a versioned selection algorithm without replacement. Result animations reveal the recorded outcome; they never select a different winner. Anyone can replay the selection and download its public proof JSON.

Discord organizers verify a server using `/verify`, choose a channel the bot can access, and optionally require roles. Members join or leave through buttons until the deadline. The organizer starts the draw from the website after the roster closes. The bot updates the announcement and sends winner-only congratulations in bounded groups. Multiple authorized wallets can independently link the same server.

## Privacy and moderation

Raw entries and salts are restricted to the organizer. Public manifests mask non-wallet entries; wallet-address entries remain public. Unlisted pages are accessible by share link. The Entries dialog exposes Discord names, IDs and join times only to the organizer, with server-side pagination and authorization.

Explorer listing is opt-in. An allowlisted admin can remove an individual giveaway from Explorer through a signed, audited action. This does not block its direct link, proof or execution. Public-content restriction is a separate moderation action. JEV and the local content filter review public title, description and rules before saving.

Undrawn Discord registrations are cleaned up 30 days after closing or early cancellation. Minimal ID tombstones and signed audit records remain. Started, uncertain and completed onchain records are excluded from that cleanup.

## Architecture

- React, Vite and RainbowKit frontend.
- Cloudflare Worker API and D1 persistence.
- SIWE authentication, EIP-712 mutations, single-use nonces and an append-only action journal.
- Permissionless UUPS consumer with explicit owner governance and authorized relayers.
- Independent VRF/chain-binding checks and deterministic selection replay. Epoch source attestations rely on coordinator verification.

The deployed consumer and implementation hashes are in `docs/lottewy-mainnet.json`. The `__LOTTEWY_MAINNET__` build flag selects one coherent chain, coordinator and consumer profile for both frontend and Worker. Do not mix profiles or import old payment/session journals into the live database.

## Development

Requires Node 24 and npm:

```sh
npm ci
npm run db:migrate
npm run dev
```

The development launcher serves the UI at `http://127.0.0.1:5173` and uses an isolated local database. Real Discord setup continues on the live domain because Discord callbacks must reach the matching database.

Keep credentials in ignored `.env` / `.dev.vars` files. Website Worker secrets are limited to JEV, Turnstile and the three Discord settings. Wallet private keys are never sent to the website Worker or frontend. `VITE_WALLETCONNECT_PROJECT_ID` is the public client configuration for WalletConnect.

## Validation and release

```sh
npm test
npm run test:e2e
npm run build:mainnet
node scripts/check-secrets.mjs
node scripts/check-staged-docs.mjs
```

Browser tests require the running development server and Microsoft Edge. Paid or live-chain checks are opt-in; unit and browser fixtures do not prove a live paid API call.

For an authorized release, apply migrations with `wrangler d1 migrations apply DB --env mainnet --remote`, then use `npm run deploy:mainnet`. Upload an explicit secret allowlist, never an entire deployment environment. Contract deployment is a separate operation; ordinary Worker redeploys must not create a new consumer. Mainnet deployment checkpoints persist signed transactions before broadcast.

Uncertain transactions stay locked until reconciled. Never reset a reserved nonce, payment journal or ambiguous draw merely to retry. Discord announcements and winner notifications likewise avoid automatic duplicate sends after uncertain delivery.

## Brand and community

Brand assets are in `public/brand/`. Arc artwork follows its official usage guidance and attribution. Lottewy community links point to [D20DAO on X](https://x.com/d20dao), [Discord](https://discord.gg/7kxhnMQXEb) and [GitHub](https://github.com/d20dao).

Secrets, databases, screenshots, artifacts and private documents are ignored. Only approved English Markdown is committed. Recovery bundles and credentials belong outside the repository.
