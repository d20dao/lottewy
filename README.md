# Lottewy

An onchain-verifiable giveaway winner picker. English interface, Workers + D1, signed wallet authentication, JEV content review and a permissionless D20DAO consumer on **Arc Testnet only**.

## Local development

Requires Node 24 and npm. No production deployment is performed by these commands.

```sh
npm ci
npm run build
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5173. The dev launcher runs Vite, local Wrangler and a background reconciliation timer. Local D1 data persists in `.wrangler/`. The site has no server-side CSV upload: CSV, TSV and pasted spreadsheet cells are parsed locally; only the selected entries enter the signed giveaway payload.

Place `JEV_API_KEY`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in the private `.env`. The dev launcher copies only these allowlisted Worker values to private `.dev.vars`; restart after changing them. Turnstile hostnames must include the serving domain (and `127.0.0.1` for local development). `VITE_WALLETCONNECT_PROJECT_ID` enables mobile QR and the full RainbowKit wallet menu. Without it, injected browser wallets work. No private key is forwarded to the frontend or Worker.

The checked Arc testnet consumer address and runtime hash are already configured in `wrangler.jsonc`. Set `ADMIN_ADDRESSES` to a comma-separated list of authorized wallet addresses for admin access. This is a server-side allowlist, not a client-side role switch.

## Included workflows

- Landing, dashboard, entry editor, public explorer, permanent giveaway pages, result presentation, replay, share cards/QR, exports and admin screens.
- Pasted mixed lists, local CSV/TSV entry and optional weight column mapping, append/explicit replace, undo, duplicate review and paginated public preview. One or several winners, with optional ordered alternates. Equal chances by default; optional public integer weights from 1 to 1,000 use versioned weighted sampling without replacement.
- Bulk weighted text accepts `entry,weight` rows and quoted CSV names. The editor keeps a wallet-scoped, per-tab draft backup; review failures preserve edits and the current step. Explicit disconnects clear local wallet drafts.
- Explorer pagination includes matching totals, numbered pages and 10/20/50 rows per page. The organizer details column stays sticky on desktop.
- Explorer listing is an explicit signed opt-in. Unlisted giveaways remain accessible by public share link; they are not access-controlled private pages. Existing records default to unlisted. JEV checks public title, description and rules for profanity, hate and adult content before saving. Backend limits are 120 characters for titles and 4,000 for descriptions and rules.
- Six optional result presentations: slot reel, decorative wheel, name scramble, countdown, balloon pop and scratch-to-reveal. All reveal the existing fixed result; keyboard alternatives, skip and reduced-motion behavior are supported.
- Multiple winners automatically reveal in rounds of at most five simultaneous animations. The organizer advances each round after viewing its results. Result cards retain equal sizes; reduced motion can reveal immediately.
- Download proof JSON independently verifies real VRF evidence before exporting the public manifest, commitments, public weights, selection trace, ordered results, VRF packet, public key and transaction references. Private raw entries and salts are excluded; demo exports are explicitly labeled.
- Reveal modes are clickable visual cards. Verification shows actual hash inputs, Keccak derivation, unbiased range sampling and the selected entry in an animated calculation trace. Every winner/alternate can be inspected, paused and replayed; green verification states require the corresponding check to pass.
- The official RainbowKit connection, account and SIWE authentication interfaces. The footer uses the unchanged official D20DAO icon from https://d20dao.org/icon.svg.
- SIWE sessions, EIP-712 mutations, revision checks, single-use nonces and append-only action journal. Owner-only raw entry access; public masks are produced on the Worker.
- Minimal non-upgradeable consumer with no platform fee or revenue recipient. D20 fee and gas are paid by the user. Overpayment, callback retry, expiry refund and refund credits are separate paths.
- Durable submission reservation, scheduled chain reconciliation, independent VRF verification and versioned offchain selection replay.
- Before saving, the Worker checks a positive native Arc USDC balance, validates Turnstile, and enforces 3 review attempts per minute and 20 per hour per wallet. These are cost controls, not proof of unique identity. Production never skips missing Turnstile configuration.
- The local content filter runs before JEV. Allowlisted admins can explicitly turn JEV off or on with a signed, revision-guarded action and recorded reason. Off uses local filtering; service errors never silently downgrade review. Local blacklists do not provide contextual classification.

## Checks

```sh
npm test
npm run contracts:compile
npm run test:e2e
node scripts/check-secrets.mjs
node scripts/check-staged-docs.mjs
```

## Brand assets

The SVG mark, outlined wordmark, favicon and OG layout are in `public/brand/`. Header/footer branding and generated share cards use the same assets. The social preview PNG is 1200 by 630 pixels; SVG/PNG/ICO favicons and an Apple touch icon are linked in the document head. Regenerate raster exports with `node scripts/render-brand.mjs` (requires installed Microsoft Edge). `npm run build:testnet` uses testnet.lottewy.com for canonical and social metadata, robots and sitemap URLs.

Browser tests use installed Microsoft Edge and the running local app. The wallet test uses an ephemeral injected wallet to verify real zero-balance rejection, then mocked records for edit recovery. It does not send chain transactions or save remote giveaway records. Unit tests use an isolated SQL database and local Hardhat EVM. `LIVE_JEV_CHECK=1` enables a small paid provider smoke test; `LIVE_PROOF_CHECK=1` enables read-only live-chain browser proof checks.

The real testnet integration is opt-in through `RUN_TESTNET=1`, with an optional `RESUME_ID` for read-only replay of an existing result. Never run it against mainnet. It rejects any chain other than 5042002 and verifies official deployment implementations before transactions. Public evidence: `docs/lottewy-testnet.json`, `docs/testnet-e2e.json`, `docs/testnet-public-manifest.json`. Test request **5256** passed SIWE, real JEV review, local D1 persistence, consumer payment, D20DAO fulfillment and independent VRF/selection replay.

## Hosted testnet

The `testnet` Wrangler environment targets `testnet.lottewy.com`, a separate remote D1 database and Arc Testnet. It uses production authentication and anti-bot behavior. The root environment remains local development. Do not deploy the root environment.

Apply remote migrations with `wrangler d1 migrations apply lottewy-testnet --env testnet --remote`. Store only `JEV_API_KEY`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` with `wrangler secret bulk --env testnet`; never upload a complete private `.env`. Deploy with `npm run deploy:testnet`. Allow the hosted domain in the Turnstile widget and WalletConnect project settings. Local D1 data is not automatically copied to the hosted database.

## Remaining mainnet release work

- Mainnet-specific chain/deployment/proof configuration and consumer deployment. Current code and published vectors intentionally remain testnet-only.
- Privacy/retention policy, JEV corpus calibration, load testing and independent security review.
- Current storage retains raw owner entries, salts, revisions and signed action history until an explicit retention/erasure feature is introduced. Account suspension blocks creating, editing and starting giveaways; it does not remove access to the owner's existing data or recovery paths. Admin authority is controlled separately by the server allowlist.
- Ambiguous submission reservations remain locked. New EOA submissions reserve an explicit nonce; the recovery UI sends a zero-value same-nonce cancellation and unlocks only after a confirmed canonical receipt and absence of a draw. Confirmed matching reverted requests also release safely. Smart-wallet and legacy reservations without a known transaction nonce stay locked until an equivalent cancellation proof is available. No timeout-based unlock.
- Full independent replay of epoch source attestations is not included. The verifier checks the VRF proof and chain bindings and relies on coordinator verification for those attestations.
- The dependency audit has remaining moderate transitive wallet-library advisories. High and critical findings were removed; a production release requires reviewing the remaining upstream issues and the actual wallet support matrix.

## Repository privacy

Markdown is ignored by default. Only this README, `UI-CONTEXT.md` and the English `docs/IMPLEMENTATION.md` are allowlisted. Private Turkish decision/design documents must never be committed. The configured `.githooks/pre-commit` rejects unapproved Markdown paths and Turkish text in allowlisted Markdown. Secrets, local DBs, design references, screenshots and test artifacts are ignored.
