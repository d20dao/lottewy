# Lottewy interface context

English is the product language. Lottewy is an onchain-verifiable giveaway winner picker; no prize custody, entry payments, subscriptions, sponsor wallets or platform fees.

The organizer prepares a list, reviews its public masked projection, signs a saved revision, then pays D20DAO and network gas to start the draw. Public visitors inspect all saved giveaways and independently verify the result.

Visual direction: warm off-white, near-black type, restrained lime, generous spacing, quiet typography. The five supplied image concepts guide composition, not product claims. Use Lottewy throughout.

Shared primitives: semantic buttons and links, styled native fields/selects, native modal dialog with Escape/focus behavior, fixed status toast, list rows, status badge, empty state. Avoid nested cards, redundant borders, invented metrics, fake proofs and hover-only controls.

Wallet connection and signed authentication use RainbowKit's own interface with a compact themed header control and neutral wallet avatar. Entry previews render a bounded page of 10, 25 or 50 rows. Optional public weights are parsed from bulk `entry,weight` text or a selected CSV column; the preview is read-only and the default remains equal chances. CSV import preserves the existing list until explicit application and supports undo. The details column stays sticky on desktop.

Unpublished drafts are backed up per wallet and giveaway in the current tab's session storage. Content-review failures preserve fields and review position. Wallet changes and explicit disconnects clear that wallet's local drafts; transient session-read network failures do not pretend to be logout.

Brand assets live in `public/brand`: an outlined wordmark and geometric L with a detached lime selection tile, plus favicon and OG variants. No external font is required to render the SVG assets.

State ownership: field editing stays in Editor; expensive normalization and selection are memoized. Polls do not replace unchanged public data. Private editor data is cleared on account changes. Demo computation is separate from live requests. Animations reveal fixed results and respect reduced motion.

Slot reel, wheel, name scramble, countdown, balloon pop and scratch are presentations of an already-recorded result. They never choose winners. Use bounded animation DOM, interruptible timers, keyboard alternatives, an explicit skip action and immediate reveal for reduced-motion users. The wheel is decorative, not a probability chart.

Verification: desktop and 390px mobile screenshots; browser tests cover the wallet login dialog, signed saving, privacy preview, duplicate validation, reveal/replay, QR download, and horizontal overflow. Follow the installed frontend-anti-slop skill. Its referenced audit scripts are absent from this installation, so use the repository checks and rendered review instead.
