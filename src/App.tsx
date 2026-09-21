import VerificationDialog from "./components/VerificationDialog";
import Pagination from "./components/Pagination";
import WalletControl from "./components/WalletControl";
import { Empty, Dialog } from "./components/primitives";
import Editor from "./Editor";
import {
  DiscordCreator,
  DiscordCampaignPage,
  DiscordCampaignList,
} from "./Discord";
import SubmissionRecovery from "./SubmissionRecovery";
import RevealStage, { type RevealMode } from "./components/RevealStage";
import { proofBundle, serializeProofBundle } from "../shared/proof-bundle";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSignTypedData,
  useWriteContract,
  useSendTransaction,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { useConnectModal, ConnectButton } from "@rainbow-me/rainbowkit";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  FileText,
  Globe2,
  Wallet,
  Plus,
  Users,
  Trophy,
  Bookmark,
  LockKeyhole,
  ExternalLink,
  Copy,
  Download,
  RotateCcw,
  Maximize,
  X,
  Flag,
  List,
  Menu,
  LogOut,
  LoaderCircle,
  CircleHelp,
} from "lucide-react";
import { formatEther, type Address } from "viem";
import QRCode from "qrcode";
import { api, signedAction } from "./api";
import { useWalletSession } from "./WalletSession";
import { arc, consumerAbi, coordinatorAbi } from "../shared/chain";
import {
  routeSeo,
  isPublicOrigin,
  SITE_ORIGIN,
  websiteData,
} from "../shared/seo";
import {
  CHAIN_ID,
  WEIGHTED_ALGORITHM,
  COORDINATOR,
  hash,
  lines,
  makeManifest,
  mask,
  normalize,
  select,
  type Draft,
  type Giveaway,
} from "../shared/core";

const statuses: Record<string, string> = {
  draft: "Preparing",
  submitting: "Awaiting wallet transaction",
  pending: "Awaiting confirmation",
  waiting: "Awaiting randomness",
  completed: "Completed",
  expired: "Expired",
  callback: "Awaiting result delivery",
  refund_due: "Refund available",
  reconciliation: "Reconciliation required",
};
const liveStatuses = new Set([
  "submitting",
  "pending",
  "waiting",
  "callback",
  "refund_due",
  "reconciliation",
]);
const emptyDraft: Draft = {
  title: "",
  description: "",
  rules: "",
  entries: [],
  winners: 1,
  reserves: 0,
};
const example: Draft = {
  title: "Community gathering",
  description: "A small thank-you to the people who build together.",
  rules:
    "Every listed entry has an equal chance. The organizer is responsible for prize delivery. Participation is free.",
  entries: [
    "Deniz Yılmaz",
    "Ayşe Demir",
    "Mert Kaya",
    "Elif Arslan",
    "Can Sönmez",
    "Zeynep Yıldız",
    "Ece Aksoy",
    "Bora Şahin",
  ],
  winners: 3,
  reserves: 2,
};
const demoBuilt = makeManifest(
  example,
  "demo",
  "0x0000000000000000000000000000000000000001",
  1,
  example.entries.map(
    (_, i) => `0x${String(i + 1).padStart(64, "0")}` as const,
  ),
);
const demo: Giveaway = {
  id: "demo",
  slug: "demo",
  owner: "0x0000000000000000000000000000000000000001",
  revision: 1,
  status: "completed",
  manifest: demoBuilt.manifest,
  commitment: demoBuilt.commitment,
  created: 0,
  review: { mode: "demo", model: "none", policy: "none" },
};
const demoWord = `0x${"42".repeat(32)}` as const;
const shorten = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function Logo() {
  return (
    <a href="/" className="brand" aria-label="Lottewy home">
      <img src="/brand/lottewy-wordmark.svg" width="149" height="32" alt="" />
    </a>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {statuses[status] || status}
    </span>
  );
}
function pageMetadata(
  title: string,
  description: string,
  indexable: boolean,
  path?: string,
) {
  const origin = import.meta.env.VITE_PUBLIC_ORIGIN || SITE_ORIGIN;
  indexable = indexable && isPublicOrigin(origin);
  document.title = title;
  const setMeta = (key: string, value: string, property = false) => {
    const attribute = property ? "property" : "name";
    let tag = document.head.querySelector<HTMLMetaElement>(
      `meta[${attribute}="${key}"]`,
    );
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute(attribute, key);
      document.head.appendChild(tag);
    }
    tag.content = value;
  };
  setMeta("description", description);
  setMeta(
    "robots",
    indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow",
  );
  setMeta("og:title", title, true);
  setMeta("og:description", description, true);
  setMeta("twitter:title", title);
  setMeta("twitter:description", description);
  document.head.querySelector('link[rel="canonical"]')?.remove();
  document.head.querySelector('meta[property="og:url"]')?.remove();
  if (indexable && path) {
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `${origin}${path}`;
    document.head.appendChild(canonical);
    setMeta("og:url", canonical.href, true);
  }
  document.getElementById("site-schema")?.remove();
  if (indexable && path === "/") {
    const schema = document.createElement("script");
    schema.id = "site-schema";
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify(websiteData(origin));
    document.head.appendChild(schema);
  }
}
function Footer() {
  return (
    <footer>
      <div className="footer-identity">
        <a href="/" className="footer-brand" aria-label="Lottewy home">
          <img
            src="/brand/lottewy-wordmark.svg"
            width="93"
            height="20"
            alt=""
          />
        </a>
        <p>Your community. A result anyone can verify.</p>
      </div>
      <a
        className="footer-provider"
        href="https://d20dao.org"
        target="_blank"
        rel="noreferrer"
      >
        <img src="/d20dao.svg" width="24" height="24" alt="" />
        <span>
          Randomness by <strong>D20DAO</strong>
        </span>
      </a>
      <p className="footer-trademark">
        Arc™ is a trademark of Circle Internet Group, Inc. and/or its
        affiliates.
      </p>
    </footer>
  );
}
function Landing() {
  const cards = [
    { number: "0001", label: "A*** M***", kind: "Name" },
    { number: "0018", label: "s***@e***.com", kind: "Email" },
    { number: "0042", label: "Entry #42", kind: "Community entry" },
    { number: "0007", label: "J*** L***", kind: "Name" },
    { number: "0025", label: "r***@s***.io", kind: "Email" },
    { number: "0036", label: "Entry #36", kind: "Community entry" },
  ];
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">A LITTLE CHANCE. A LOT OF PROOF.</p>
          <h1 id="hero-title">
            Leave it to chance.
            <br />
            Share the proof.
          </h1>
          <p className="hero-description">
            Verifiable giveaways for Discord servers and Web3 communities.
            <span className="hero-network">
              Built on{" "}
              <a
                className="hero-arc-link"
                href="https://www.arc.io/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Built on Arc Network, visit the official website"
              >
                <img
                  className="hero-arc-logo"
                  src="/brand/arc-logo-black.svg"
                  alt="Arc Network™"
                  width="146"
                  height="50"
                />
              </a>
            </span>
          </p>
          <div className="actions">
            <a className="button primary" href="/create">
              Create a giveaway <ArrowRight size={19} />
            </a>
            <a className="button secondary" href="/explorer">
              Explore giveaways <ArrowRight size={18} />
            </a>
          </div>
          <p className="hero-fees">
            <strong>Pay in native USDC.</strong> Review the D20DAO randomness
            fee and estimated network gas before starting your draw.
          </p>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-note">
            <ShieldCheck size={19} />
            <span>
              Provable onchain.
              <br />
              Replayable by anyone.
            </span>
          </div>
          <div className="ticket-window" aria-hidden="true">
            <div className="ticket-flow">
              {[0, 1].map((copy) => (
                <div className="ticket-flow-group" key={copy}>
                  {cards.map((card, index) => (
                    <div
                      className={`flow-ticket ticket-tone-${index % 3}`}
                      key={card.number}
                    >
                      <div>
                        <span>#{card.number}</span>
                        <span>{card.kind}</span>
                      </div>
                      <b>{card.label}</b>
                      <span className="ticket-rule" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="hero-art-footer">
            <p className="art-caption">One result. An open record.</p>
          </div>
        </div>
      </section>
      <section id="how" className="how" aria-label="How Lottewy giveaways work">
        <article>
          <span className="step-num">01</span>
          <FileText />
          <h2>Build your list</h2>
          <p>
            Paste names, usernames, emails or wallet addresses, or import a CSV.
            Choose equal chances or public entry weights.
          </p>
        </article>
        <article>
          <span className="step-num">02</span>
          <Trophy />
          <h2>Start the draw</h2>
          <p>
            Review the USDC cost and confirm in your wallet. Your list and rules
            lock before{" "}
            <a
              href="https://d20dao.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              D20DAO
            </a>{" "}
            randomness determines the selection.
          </p>
        </article>
        <article>
          <span className="step-num">03</span>
          <Globe2 />
          <h2>Share the proof</h2>
          <p>
            Share the result page and download its proof. Anyone can reproduce
            the selection from the public manifest and onchain randomness.
          </p>
        </article>
      </section>
      <section
        className="community-cases"
        aria-labelledby="community-cases-title"
      >
        <div className="community-cases-intro">
          <p className="eyebrow">MADE FOR YOUR COMMUNITY</p>
          <h2 id="community-cases-title">
            Quick to set up.
            <br />
            Open to verify.
          </h2>
          <p>
            Start with the people who qualify. Lottewy handles the draw and its
            proof, while your team stays in charge of eligibility and rewards.
          </p>
          <a className="text-button" href="/create">
            Start with your list <ArrowRight size={17} />
          </a>
        </div>
        <div className="community-case-list">
          <article className="community-case">
            <span className="case-audience">Discord servers</span>
            <div>
              <h3>A draw after community night</h3>
              <p>
                Paste eligible usernames or import a member list, choose your
                winners and alternates, then post the verifiable result link in
                your server.
              </p>
              <p className="case-example">
                <span>Example</span> 3 event winners · 2 alternates
              </p>
            </div>
          </article>
          <article className="community-case">
            <span className="case-audience">Blockchain communities</span>
            <div>
              <h3>Community rewards from a wallet list</h3>
              <p>
                Bring the wallet addresses that qualify. Members can inspect the
                public addresses and commitments, then check the randomness and
                selected order.
              </p>
              <p className="case-example">
                <span>Example</span> Contributor rewards · wallet addresses
              </p>
            </div>
          </article>
          <article className="community-case">
            <span className="case-audience">Web3 campaigns</span>
            <div>
              <h3>Different contributions, clear odds</h3>
              <p>
                Import entries with a weight column for a weighted draw. Publish
                the rules and weights so participants can reproduce how each
                winner was selected.
              </p>
              <p className="case-example">
                <span>Example</span> Campaign entries · CSV with weights
              </p>
            </div>
          </article>
        </div>
      </section>
      <section className="plain-note">
        <ShieldCheck />
        <div>
          <h2>Open selection. Thoughtful privacy.</h2>
          <p>
            Your list stays offchain; a commitment to the list and rules is
            bound onchain. Names and emails are masked, while valid wallet
            addresses stay public. The organizer delivers the prize.
          </p>
        </div>
        <a href="/explorer">
          Open the explorer <ArrowRight size={18} />
        </a>
      </section>
    </>
  );
}
export default function App() {
  const path = location.pathname,
    isLanding = path === "/",
    isDemo = import.meta.env.DEV && path === "/demo";
  useEffect(() => {
    // Preserve the Worker's visibility-aware metadata until the public record
    // loads; do not briefly mark an indexable listed giveaway as noindex.
    if (path.startsWith("/g/")) return;
    const meta = routeSeo(
      path,
      import.meta.env.VITE_PUBLIC_ORIGIN || SITE_ORIGIN,
    );
    pageMetadata(
      isDemo ? "Giveaway Demo | Lottewy" : meta.title,
      meta.description,
      meta.indexable,
      meta.path,
    );
  }, [path, isLanding, isDemo]);
  const { address, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { user, authReady } = useWalletSession();
  const [config, setConfig] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [creationSource, setCreationSource] = useState(
    new URLSearchParams(location.search).get("mode") === "discord"
      ? "discord"
      : "list",
  );
  const navRef = useRef<HTMLElement>(null),
    menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!navOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !navRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setNavOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [navOpen]);
  useEffect(() => {
    api("/config")
      .then(setConfig)
      .catch((e) => setToast(e.message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(t);
  }, [toast]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setToast(
        e instanceof Error ? e.message : "The action could not be completed",
      );
    } finally {
      setBusy(false);
    }
  };
  const login = () => openConnectModal?.();
  const mutate = async (
    type: string,
    id: string,
    revision: number,
    payload: unknown,
    progress?: (message: string) => void,
    checks?: { turnstileToken?: string },
  ) => {
    if (!user || !address || user.address !== address.toLowerCase())
      throw new Error("Connect your wallet and sign in first.");
    return signedAction(
      address,
      signTypedDataAsync,
      type,
      id,
      revision,
      payload,
      progress,
      checks,
    );
  };
  const workspace =
    ["/dashboard", "/create", "/edit", "/history", "/admin"].some((p) =>
      path.startsWith(p),
    ) || path === "/discord";
  const discordProps = {
    user,
    config,
    busy,
    run,
    mutate,
    notify: setToast,
    onLogin: login,
  };
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <Logo />
        <nav
          ref={navRef}
          id="main-navigation"
          className={navOpen ? "nav open" : "nav"}
          aria-label="Main navigation"
        >
          <a className={path === "/explorer" ? "active" : ""} href="/explorer">
            Explorer
          </a>
          <a href="/#how">How it works</a>
          <a
            className={path === "/dashboard" ? "active" : ""}
            href="/dashboard"
          >
            My giveaways
          </a>
        </nav>
        <div className="header-actions">
          <WalletControl />
          <button
            className="icon-button mobile-menu"
            ref={menuRef}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
            aria-controls="main-navigation"
            onClick={() => setNavOpen(!navOpen)}
          >
            {navOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <div className={workspace ? "workspace" : ""}>
        {workspace && (
          <aside>
            <a
              className={path === "/dashboard" ? "active" : ""}
              href="/dashboard"
            >
              <FileText size={20} />
              My giveaways
            </a>
            <a className={path === "/create" ? "active" : ""} href="/create">
              <Plus size={20} />
              New giveaway
            </a>
            <a className={path === "/history" ? "active" : ""} href="/history">
              <Wallet size={20} />
              Activity history
            </a>
            <a className={path === "/discord" ? "active" : ""} href="/discord">
              <Users size={20} /> Discord registrations
            </a>
            {user?.admin && (
              <a href="/admin">
                <ShieldCheck size={20} />
                Administration
              </a>
            )}
            <div className="aside-bottom">
              <img
                src="/brand/lottewy-mark.svg"
                width="34"
                height="34"
                alt=""
              />
              <p>
                Chance passes.
                <br />
                Proof stays.
              </p>
              <small>Verifiable giveaway selection</small>
            </div>
          </aside>
        )}
        <main
          id="main"
          className={
            isLanding ? "landing" : workspace ? "workspace-main" : "public-main"
          }
        >
          {path === "/create" && (
            <div
              className="creation-source"
              role="group"
              aria-label="Entry source"
            >
              <button
                type="button"
                disabled={busy}
                aria-pressed={creationSource === "list"}
                onClick={() => {
                  setCreationSource("list");
                  history.replaceState(null, "", "/create");
                }}
              >
                List or CSV
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={creationSource === "discord"}
                onClick={() => {
                  setCreationSource("discord");
                  history.replaceState(null, "", "/create?mode=discord");
                }}
              >
                Discord registration
              </button>
            </div>
          )}
          {isLanding ? (
            <Landing />
          ) : path === "/create" && creationSource === "discord" ? (
            <DiscordCreator {...discordProps} />
          ) : path === "/create" || path.startsWith("/edit/") ? (
            <Editor
              onLogin={login}
              user={user}
              busy={busy}
              run={run}
              mutate={mutate}
              refresh={() => setRefresh((x) => x + 1)}
              config={config}
              notify={setToast}
            />
          ) : path === "/dashboard" || path === "/explorer" ? (
            <Listing
              mine={path === "/dashboard"}
              user={user}
              login={login}
              refresh={refresh}
            />
          ) : path === "/history" ? (
            <History user={user} />
          ) : path === "/discord" ? (
            <DiscordCampaignList {...discordProps} />
          ) : path.startsWith("/discord/") ? (
            <DiscordCampaignPage {...discordProps} />
          ) : path === "/admin" ? (
            <Admin user={user} run={run} busy={busy} mutate={mutate} />
          ) : isDemo || path.startsWith("/g/") || path.startsWith("/agent/") ? (
            <GiveawayPage
              isDemo={isDemo}
              user={user}
              config={config}
              run={run}
              busy={busy}
              mutate={mutate}
              notify={setToast}
              write={writeContractAsync}
              send={sendTransactionAsync}
              client={publicClient}
              switchChain={switchChainAsync}
            />
          ) : (
            <Empty title="Page not found">
              <a className="button primary" href="/">
                Back to home
              </a>
            </Empty>
          )}
        </main>
      </div>
      <Footer />
      <div className="toast" role="status" aria-live="polite" hidden={!toast}>
        {toast}
        <button
          onClick={() => setToast("")}
          className="icon-button"
          aria-label="Dismiss notification"
        >
          <X size={17} />
        </button>
      </div>
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={16} /> Working…
        </div>
      )}
    </>
  );
}
type Common = {
  user: any;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  mutate: (
    type: string,
    id: string,
    rev: number,
    payload: unknown,
  ) => Promise<any>;
};
function Recovery({
  g,
  run,
  busy,
  write,
  notify,
}: {
  g: Giveaway;
  run: Common["run"];
  busy: boolean;
  write: any;
  notify: (s: string) => void;
}) {
  const r = g.recovery!;
  const transact = (
    address: string,
    abi: any,
    functionName: string,
    args: any[],
  ) =>
    run(async () => {
      await write({ chainId: CHAIN_ID, address, abi, functionName, args });
      notify(
        "Recovery transaction submitted. Its status will update after confirmation.",
      );
    });
  return (
    <section className="panel recovery">
      <h2>Request and refunds</h2>
      <p className="small">
        D20DAO request #{r.requestId} · Service fee paid{" "}
        {formatEther(BigInt(r.feePaid))} USDC · Refund if eligible after
        failure: {r.refundBps / 100}% of the service fee. Network gas is not
        refundable.
      </p>
      <p className="small muted">
        Refunds, callback delivery and overpayments are handled separately. None
        unlocks the list or requests new randomness.
      </p>
      <div className="actions wrap">
        {r.callbackFailed && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              transact(COORDINATOR, coordinatorAbi, "retryCallback", [
                BigInt(r.requestId),
                250000,
              ])
            }
          >
            Redeliver the same result
          </button>
        )}
        {r.refundable && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              transact(COORDINATOR, coordinatorAbi, "refundRequest", [
                BigInt(r.requestId),
              ])
            }
          >
            Claim expired request refund
          </button>
        )}
        {BigInt(r.refundCredit) > 0n && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              transact(COORDINATOR, coordinatorAbi, "withdrawRefundCredit", [
                g.owner,
              ])
            }
          >
            D20DAO credit: {formatEther(BigInt(r.refundCredit))} USDC
          </button>
        )}
        {BigInt(r.overpaymentCredit) > 0n && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              transact(r.consumer, consumerAbi, "withdrawOverpayment", [
                g.owner,
              ])
            }
          >
            Overpayment credit: {formatEther(BigInt(r.overpaymentCredit))} USDC
          </button>
        )}
      </div>
      {r.refunded && (
        <p className="small">
          The service fee refund was processed onchain. Gas is not refunded.
        </p>
      )}
    </section>
  );
}
function Listing({
  mine,
  user,
  login,
  refresh,
}: {
  mine: boolean;
  user: any;
  login: () => void;
  refresh: number;
}) {
  const [items, setItems] = useState<
      | (Pick<
          Giveaway,
          "id" | "slug" | "owner" | "revision" | "status" | "created" | "hidden"
        > & { manifest?: { title: string }; entryCount?: number })[]
      | null
    >(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [date, setDate] = useState(""),
    [listPage, setListPage] = useState(0),
    [pageSize, setPageSize] = useState(10),
    [total, setTotal] = useState(0),
    [listLoading, setListLoading] = useState(false);
  const requestVersion = useRef(0);
  const load = () => {
    const current = ++requestVersion.current;
    setError("");
    setListLoading(true);
    if (mine && !user) {
      setItems(null);
      setListLoading(false);
      return;
    }
    const params = new URLSearchParams({
      mine: mine ? "1" : "0",
      q: query,
      status,
      date,
      offset: String(listPage * pageSize),
      limit: String(pageSize),
      paged: "1",
    });
    api(`/giveaways?${params}`)
      .then((next) => {
        if (current === requestVersion.current) {
          setItems(next.items);
          setListLoading(false);
          setTotal(next.total);
          if (listPage > 0 && listPage * pageSize >= next.total)
            setListPage(Math.max(0, Math.ceil(next.total / pageSize) - 1));
        }
      })
      .catch((e) => {
        if (current === requestVersion.current) {
          setError(e.message);
          setListLoading(false);
        }
      });
  };
  useEffect(() => {
    const timer = setTimeout(load, query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      requestVersion.current++;
    };
  }, [mine, user?.address, refresh, query, status, date, listPage, pageSize]);
  const filtered = items;
  const hasFilters = !!(query.trim() || status || date);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{mine ? "YOUR SPACE" : "THE PUBLIC RECORD"}</p>
          <h1>{mine ? "My giveaways" : "Chance, on the record."}</h1>
          <p>
            {mine
              ? "Prepare your lists, manage your draws and share the results."
              : "From preparation to results, every saved public Lottewy giveaway is here."}
          </p>
        </div>
        <a href="/create" className="button lime">
          <Plus size={19} />
          New giveaway
        </a>
      </div>
      {mine && !user ? (
        <Empty icon={<Wallet />} title="Your giveaways belong to your wallet.">
          <p>Sign in with your wallet to save and manage your lists.</p>
          <button className="button primary" onClick={login}>
            Sign in with wallet
          </button>
        </Empty>
      ) : (
        <>
          <div className="filters">
            <label>
              <span className="sr-only">Search title, address or ID</span>
              <input
                placeholder="Search title, address or ID…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListPage(0);
                }}
              />
            </label>
            <label>
              <span className="sr-only">Status</span>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setListPage(0);
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(statuses).map(([s, t]) => (
                  <option key={s} value={s}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setListPage(0);
                }}
              />
            </label>
          </div>
          {error ? (
            <Empty title="Could not load the list">
              <p role="alert">{error}</p>
              <button onClick={load} className="button secondary">
                Try again
              </button>
            </Empty>
          ) : !items ? (
            <div className="loading" role="status">
              <LoaderCircle className="spin" />
              Loading giveaways…
            </div>
          ) : filtered?.length ? (
            <div className="giveaway-list" aria-busy={listLoading}>
              <div className="list-header">
                <span>Giveaway</span>
                <span>Entries</span>
                <span>Status</span>
                <span>Date</span>
                <span />
              </div>
              {filtered.map((g) => (
                <a className="giveaway-row" key={g.id} href={`/g/${g.slug}`}>
                  <div className="row-title">
                    <span className="row-mark">
                      <FileText />
                    </span>
                    <div>
                      <h2>
                        {g.hidden ? "Content under review" : g.manifest?.title}
                      </h2>
                      <p>
                        {shorten(g.owner)} · Revision {g.revision}
                      </p>
                    </div>
                  </div>
                  <span className="entry-count">
                    {g.entryCount ?? "Unknown"}{" "}
                    <span className="mobile-label">entries</span>
                  </span>
                  <Badge status={g.status} />
                  <time>
                    {new Date(g.created * 1000).toLocaleDateString("en-US")}
                  </time>
                  <ArrowRight size={19} />
                </a>
              ))}
            </div>
          ) : (
            <Empty
              title={
                hasFilters
                  ? "No matching giveaways."
                  : mine
                    ? "Your first giveaway starts here."
                    : "No public giveaways yet."
              }
            >
              <p>
                {hasFilters
                  ? "Try a different search or filter."
                  : mine
                    ? "Prepare a list and save your first giveaway."
                    : "Giveaways shared publicly will appear here."}
              </p>
              <a
                className="button secondary"
                href={
                  hasFilters ? (mine ? "/dashboard" : "/explorer") : "/create"
                }
              >
                {hasFilters ? "Clear filters" : "Start your list"}
                <ArrowRight size={17} />
              </a>
            </Empty>
          )}
        </>
      )}
      {items && (
        <Pagination
          busy={listLoading}
          page={listPage}
          total={total}
          size={pageSize}
          onPage={setListPage}
          onSize={(size) => {
            setPageSize(size);
            setListPage(0);
          }}
        />
      )}
      <p className="small muted bottom-note">
        <Globe2 size={16} />
        Every record is public. Names and emails are masked on the server.
      </p>
    </>
  );
}
function History({ user }: { user: any }) {
  const [data, setData] = useState<any[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api("/history")
        .then(setData)
        .catch((e) => setError(e.message));
    else setData(null);
  }, [user?.address]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity history</h1>
          <p>A record of your signed actions and revisions.</p>
        </div>
      </div>
      {!user ? (
        <Empty title="Please sign in with your wallet">
          <p>Your history is linked to your wallet.</p>
        </Empty>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading…</p>
      ) : !data.length ? (
        <Empty title="No activity yet">
          <p>Your first saved action will appear here.</p>
        </Empty>
      ) : (
        <div className="history-list">
          {data.map((d) => (
            <article key={d.action_id}>
              <FileText />
              <div>
                <strong>{d.action_type}</strong>
                <p className="mono">{d.target}</p>
              </div>
              <span>Revision {d.result_revision}</span>
              <time>{new Date(d.accepted * 1000).toLocaleString("en-US")}</time>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function GiveawayPage({
  isDemo,
  user,
  config,
  run,
  busy,
  mutate,
  notify,
  write,
  send,
  client,
  switchChain,
}: Common & {
  isDemo: boolean;
  config: any;
  notify: (s: string) => void;
  write: any;
  send: any;
  client: any;
  switchChain: any;
}) {
  const slug = location.pathname.split("/")[2];
  const isAgent = location.pathname.startsWith("/agent/");
  const [g, setG] = useState<Giveaway | null>(isDemo ? demo : null),
    [error, setError] = useState(""),
    [revealed, setRevealed] = useState(false),
    [revealMode, setRevealMode] = useState<RevealMode>("simple"),
    [proofOpen, setProofOpen] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [reason, setReason] = useState(""),
    [startOpen, setStartOpen] = useState(false),
    [pricing, setPricing] = useState<any>(null),
    [gas, setGas] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const loading = useRef<Promise<void> | null>(null),
    mounted = useRef(true);
  const load = useCallback(
    (syncId?: string) => {
      if (loading.current) return loading.current;
      const request = (
        isAgent
          ? fetch(
              `${config?.agentApiOrigin || "https://api.lottewy.com"}/v1/giveaways/${encodeURIComponent(slug)}`,
            ).then(async (response) => {
              const result = (await response.json()) as {
                giveaway?: Giveaway;
                error?: string;
                status: string;
              };
              if (!response.ok || !result.giveaway)
                throw new Error(
                  result.error ||
                    "The agent operation has not published a giveaway yet.",
                );
              const status = ["paid", "submitting"].includes(result.status)
                ? "pending"
                : result.status;
              return { ...result.giveaway, status };
            })
          : syncId
            ? api(`/giveaways/${syncId}/sync`, {})
            : api(`/giveaways/${slug}`)
      )
        .then((next: Giveaway) => {
          if (!mounted.current) return;
          setError("");
          setG((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
        })
        .catch((e) => {
          if (mounted.current) setError(e.message);
        })
        .finally(() => {
          if (loading.current === request) loading.current = null;
        });
      loading.current = request;
      return request;
    },
    [
      slug,
      user?.address,
      isAgent,
      isAgent ? config?.agentApiOrigin : undefined,
    ],
  );
  const word = isDemo
    ? demoWord
    : g?.status === "completed"
      ? g.evidence?.word
      : undefined;
  useEffect(() => {
    if (!g || isDemo) return;
    pageMetadata(
      g.hidden
        ? "Giveaway under review | Lottewy"
        : `${g.manifest.title} | Lottewy`,
      "Inspect this giveaway’s public rules and entries. When the draw is complete, replay its recorded selection and check the onchain evidence.",
      g.listed === true && !g.hidden && !isAgent,
      `/g/${encodeURIComponent(g.slug)}`,
    );
  }, [g?.manifest?.title, g?.listed, g?.hidden, g?.slug, isDemo]);
  const outcome = useMemo(
    () =>
      g && !g.hidden && word ? select(g.manifest, word, g.commitment) : null,
    [g, word],
  );
  useEffect(() => {
    mounted.current = true;
    if (!isDemo) void load();
    return () => {
      mounted.current = false;
    };
  }, [load, isDemo]);
  useEffect(() => {
    if (isDemo || !g || !liveStatuses.has(g.status)) return;
    let stopped = false;
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (stopped || document.hidden || refreshing) return;
      refreshing = true;
      await load(g.id);
      refreshing = false;
      if (!stopped && !document.hidden) timer = setTimeout(refresh, 3000);
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    if (!document.hidden) void refresh();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [g?.id, g?.status, isDemo, load]);
  if (error && !g)
    return (
      <Empty title="Could not open giveaway">
        <p role="alert">{error}</p>
        <button className="button secondary" onClick={() => void load()}>
          Try again
        </button>
      </Empty>
    );
  if (!g)
    return (
      <div className="loading" role="status">
        <LoaderCircle className="spin" />
        Loading giveaway…
      </div>
    );
  if (g.hidden)
    return (
      <Empty title="Content under review">
        <p>
          The giveaway record is preserved. Moderation does not change the
          result or onchain evidence.
        </p>
        <code>{g.commitment}</code>
      </Empty>
    );
  const owner = !isAgent && user?.address === g.owner,
    entries = g.manifest.entries;
  const prepare = () =>
    run(async () => {
      setPricing(null);
      setStartOpen(true);
      const q = await api("/quote");
      setPricing(q);
      if (client && user) {
        const units = await client.estimateContractGas({
          account: user.address,
          address: q.consumer,
          abi: consumerAbi,
          functionName: "start",
          args: [hash(g.id), g.commitment],
          value: BigInt(q.value),
        });
        const price = await client.getGasPrice();
        setGas(formatEther(BigInt(units) * BigInt(price)));
      }
    });
  const start = () =>
    run(async () => {
      if (!pricing) throw new Error("Waiting for a fee quote");
      await switchChain({ chainId: CHAIN_ID });
      const reserved = await mutate("start", g.id, g.revision, {
        commitment: g.commitment,
      });
      setStartOpen(false);
      setG(reserved);
      try {
        const txHash = await write({
          chainId: CHAIN_ID,
          address: pricing.consumer,
          abi: consumerAbi,
          functionName: "start",
          args: [hash(g.id), g.commitment],
          value: BigInt(pricing.value),
          ...(reserved.reservation?.nonce !== null
            ? { nonce: reserved.reservation.nonce }
            : {}),
        });
        await api("/submission-hint", { id: g.id, txHash, kind: "start" });
        await load();
        notify(
          "Transaction submitted. Tracking continues even if you close this tab.",
        );
      } catch {
        throw new Error(
          "Submission is uncertain. The list remains locked; no second request was opened.",
        );
      }
    });
  const exportResult = () =>
    run(async () => {
      if (owner && !isDemo) {
        const full = await api(`/giveaways/${g.id}/private`);
        download(
          `lottewy-${g.slug}-private.json`,
          JSON.stringify({ giveaway: full, outcome }, null, 2),
        );
      } else
        download(
          `lottewy-${g.slug}.json`,
          JSON.stringify({ giveaway: g, outcome, demo: isDemo }, null, 2),
        );
    });
  const share = () =>
    run(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 630;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f9f9f5";
      ctx.fillRect(0, 0, 1200, 630);
      ctx.fillStyle = "#182012";
      const brandImage = new Image();
      brandImage.src = "/brand/lottewy-wordmark.svg";
      await brandImage.decode();
      ctx.drawImage(brandImage, 70, 44, 224, 48);
      ctx.font = "bold 54px sans-serif";
      ctx.fillText(g.manifest.title.slice(0, 32), 70, 195);
      ctx.font = "24px sans-serif";
      ctx.fillText(
        isDemo
          ? "DEMO · Not onchain proof"
          : "Permanent results and independent replay",
        70,
        245,
      );
      ctx.font = "bold 30px sans-serif";
      outcome?.winners.slice(0, 4).forEach((id, i) => {
        const label = entries[id - 1].label;
        ctx.fillText(`${i + 1}. ${label}`, 70, 325 + i * 55, 760);
      });
      const qr = await QRCode.toDataURL(location.href, {
        width: 210,
        margin: 1,
      });
      const img = new Image();
      img.src = qr;
      await img.decode();
      ctx.drawImage(img, 920, 330, 210, 210);
      ctx.font = "18px sans-serif";
      ctx.fillText(
        "Prize delivery is the organizer’s responsibility.",
        70,
        590,
      );
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `lottewy-${g.slug}.png`;
      a.click();
    });
  return (
    <>
      <div className="public-top">
        <a className="back" href="/explorer">
          <ArrowLeft size={17} />
          Back to explorer
        </a>
        <button
          className="button secondary"
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(location.href);
              notify("Link copied.");
            })
          }
        >
          <Copy size={17} />
          Copy link
        </button>
      </div>
      {isDemo && (
        <div className="demo-banner">
          <CircleHelp size={18} />
          <strong>Demo giveaway</strong> · Fixed sample data. No real randomness
          request, JEV approval or onchain proof.
        </div>
      )}
      <section className="giveaway-heading">
        <p className="eyebrow">
          {isDemo ? "TRY IT. REVEAL IT. REPLAY IT." : "PUBLIC GIVEAWAY"}
        </p>
        <h1>
          {revealed && outcome
            ? g.manifest.winners === 1
              ? "Meet the winner."
              : "Meet the winners."
            : g.manifest.title}
        </h1>
        <p>{revealed ? g.manifest.title : `Organized by: ${g.owner}`}</p>
        <div className="stats">
          <span>
            <Users />
            {entries.length} entries
          </span>
          <span>
            <Trophy />
            {g.manifest.winners}{" "}
            {g.manifest.winners === 1 ? "winner" : "winners"}
          </span>
          <span>
            <Bookmark />
            {g.manifest.reserves}{" "}
            {g.manifest.reserves === 1 ? "alternate" : "alternates"}
          </span>
        </div>
        <Badge status={g.status} />
      </section>
      {outcome ? (
        <>
          {!revealed ? (
            <RevealStage
              demo={isDemo}
              entries={entries}
              winners={outcome.winners}
              mode={revealMode}
              onMode={setRevealMode}
              onComplete={() => setRevealed(true)}
            />
          ) : (
            <div className="winners revealed" aria-live="polite">
              {(revealed ? outcome.winners : [outcome.winners[0]]).map(
                (id, i) => (
                  <article className="winner" key={`${id}:${revealed}`}>
                    <span className="rank">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="winner-avatar">
                      <Users size={32} />
                    </div>
                    <h2>
                      {revealed ? entries[id - 1].label : "The result is ready"}
                    </h2>
                    <p>
                      {revealed
                        ? `#${String(id).padStart(4, "0")}`
                        : "Reveal the finalized result."}
                    </p>
                  </article>
                ),
              )}
            </div>
          )}
          {revealed && outcome.reserves.length > 0 && (
            <section className="reserves">
              <h2>Alternates</h2>
              <ol>
                {outcome.reserves.map((id) => (
                  <li key={id}>
                    <strong>{entries[id - 1].label}</strong>
                    <span>#{String(id).padStart(4, "0")}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="presentation-actions">
            {revealed && (
              <>
                <button className="button primary" onClick={share}>
                  <Download size={18} />
                  Share card / QR
                </button>
                <button
                  className="button secondary"
                  onClick={() => setProofOpen(true)}
                >
                  <ShieldCheck size={19} />
                  Verify
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const proof = isDemo
                        ? undefined
                        : await (await import("../shared/proof")).verifyD20(g);
                      const bundle = proofBundle(
                        g,
                        isDemo ? demoWord : g.evidence!.word,
                        proof,
                        isDemo,
                      );
                      download(
                        `lottewy-${g.id}-proof.json`,
                        serializeProofBundle(bundle),
                      );
                      notify(
                        isDemo
                          ? "Demo proof JSON downloaded."
                          : "Verified proof JSON downloaded.",
                      );
                    })
                  }
                >
                  <Download size={18} />
                  {busy ? "Preparing proof…" : "Download proof JSON"}
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setRevealed(false);
                  }}
                >
                  <RotateCcw size={18} />
                  Play again
                </button>
              </>
            )}
          </div>
          <div className="presentation-sub">
            <p>
              <CircleHelp size={16} />
              The animation reveals the recorded result. It does not decide it.
            </p>
            <button
              className="text-button"
              onClick={() =>
                run(async () => {
                  if (!document.fullscreenElement)
                    await document.documentElement.requestFullscreen();
                  else await document.exitFullscreen();
                })
              }
            >
              <Maximize size={16} />
              Full screen
            </button>
          </div>
        </>
      ) : (
        <section className="pending-state">
          <LockKeyhole size={36} />
          <h2>
            {g.status === "draft"
              ? owner
                ? g.registration
                  ? "Registration is closed. Next, the draw."
                  : "Your list is ready. Next, the draw."
                : "This giveaway is being prepared."
              : statuses[g.status]}
          </h2>
          <p>
            {g.status === "draft"
              ? owner
                ? g.registration
                  ? "The participant list and rules are fixed. Review the entries and start the draw when ready."
                  : "You can edit the list and rules until the VRF request is submitted."
                : g.registration
                  ? "The participant list and rules are fixed. The organizer will start the draw."
                  : "The organizer can edit the entries and rules until the draw is submitted."
              : "The list and rules are locked. An uncertain transaction never opens a second request."}
          </p>
          {liveStatuses.has(g.status) && (
            <p className="live-update-status" role="status">
              {error
                ? "Live updates interrupted. Retrying automatically."
                : "Checking the recorded status automatically. You can keep this page open."}
            </p>
          )}
          {owner && g.status === "draft" && (
            <div className="actions">
              {!g.registration && (
                <a className="button secondary" href={`/edit/${g.id}`}>
                  Edit list
                </a>
              )}
              <button
                className="button lime"
                disabled={busy || !config?.chainReady}
                onClick={prepare}
              >
                Start the draw <ArrowRight size={18} />
              </button>
            </div>
          )}
          {owner && !config?.chainReady && g.status === "draft" && (
            <p className="small muted">
              The giveaway contract is not configured yet.
            </p>
          )}
          {g.status === "expired" && g.evidence && (
            <button
              className="button secondary"
              onClick={() =>
                run(async () => {
                  await write({
                    address: COORDINATOR,
                    abi: coordinatorAbi,
                    functionName: "withdrawRefundCredit",
                    args: [user.address],
                  });
                })
              }
            >
              Withdraw D20DAO refund credit
            </button>
          )}
        </section>
      )}
      {owner && ["submitting", "pending"].includes(g.status) && (
        <SubmissionRecovery
          g={g}
          client={client}
          send={send}
          busy={busy}
          run={run}
          notify={notify}
        />
      )}
      {owner &&
        g.recovery &&
        g.recovery.refundCredit !== undefined &&
        g.recovery.overpaymentCredit !== undefined && (
          <Recovery g={g} run={run} busy={busy} write={write} notify={notify} />
        )}
      <section className="proof-strip">
        <div>
          <ShieldCheck />
          <span>
            <strong>
              {isDemo
                ? "About demo evidence"
                : g.evidence
                  ? "Onchain record available"
                  : "No onchain evidence yet"}
            </strong>
            <small>Selection is calculated offchain and can be replayed.</small>
          </span>
        </div>
        <div>
          <span>
            <strong>List commitment</strong>
            <small className="mono">{shorten(g.commitment)}</small>
          </span>
        </div>
        <div>
          <span>
            <strong>Algorithm</strong>
            <small>
              {g.manifest.algorithm === WEIGHTED_ALGORITHM
                ? "Weighted / v2"
                : "Fisher–Yates / v1"}
            </small>
          </span>
        </div>
        <button className="text-button" onClick={() => setProofOpen(true)}>
          Proof details <ArrowRight size={18} />
        </button>
      </section>
      <div className="details-grid">
        <section>
          <h2>Entries</h2>
          <p className="small muted">
            Wallet addresses are shown in full; other entries are masked.
          </p>
          <div className="preview-list">
            {entries.slice(page * 50, (page + 1) * 50).map((e) => (
              <div key={e.id}>
                <span>#{String(e.id).padStart(4, "0")}</span>
                <b>{e.label}</b>
                {e.weight !== undefined && (
                  <span className="entry-weight">Weight {e.weight}</span>
                )}
              </div>
            ))}
          </div>
          {entries.length > 50 && (
            <div className="actions">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page + 1} / {Math.ceil(entries.length / 50)}
              </span>
              <button
                disabled={(page + 1) * 50 >= entries.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
        <section>
          <h2>About this giveaway</h2>
          <p className="preserve">{g.manifest.description}</p>
          <h3>Rules</h3>
          <p className="preserve">{g.manifest.rules}</p>
          <p className="selection-summary">
            {g.manifest.algorithm === WEIGHTED_ALGORITHM
              ? "Weighted selection. Public weights are committed with the list; each selected entry is removed completely."
              : "Equal-chance selection. Each entry can be selected once."}
          </p>
          {!!g.history?.length && (
            <details className="revision-history">
              <summary>Saved revisions and request history</summary>
              <p className="small">
                Saved revisions are offchain. Only the requested revision is
                bound to onchain randomness.
              </p>
              <ol>
                {g.history.map((h) => (
                  <li key={h.revision}>
                    <strong>Revision {h.revision}</strong>
                    <code>{h.commitment}</code>
                  </li>
                ))}
              </ol>
              {g.attempts?.map((attempt, i) => (
                <p key={i} className="small">
                  Submission {attempt.outcome} ·{" "}
                  <a
                    href={`${arc.blockExplorers.default.url}/tx/${attempt.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View confirmed transaction
                  </a>
                </p>
              ))}
            </details>
          )}
          <p className="small muted">
            Prize delivery is the organizer’s responsibility. This record does
            not verify real-world identities or prize delivery.
          </p>
          <div className="actions wrap">
            <button className="text-button" onClick={exportResult}>
              <Download size={17} />
              {owner ? "Organizer export" : "Download public manifest"}
            </button>
            {!isDemo && !isAgent && (
              <button
                className="text-button"
                onClick={() => setReportOpen(true)}
              >
                <Flag size={17} />
                Report content
              </button>
            )}
          </div>
        </section>
      </div>
      <VerificationDialog
        open={proofOpen}
        close={() => setProofOpen(false)}
        g={g}
        word={word}
        demo={isDemo}
      />
      <Dialog
        open={reportOpen}
        close={() => setReportOpen(false)}
        title="Report content"
      >
        <p>
          Reports are reviewed. They do not automatically change the result.
        </p>
        <label>
          Reason for reporting
          <textarea
            minLength={10}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {!user && <p>Sign in to submit a report.</p>}
        <button
          className="button primary"
          disabled={busy || !user || reason.trim().length < 10}
          onClick={() =>
            run(async () => {
              await mutate("report", g.id, g.revision, { reason });
              setReportOpen(false);
              setReason("");
              notify("Report added to the review queue.");
            })
          }
        >
          Sign and report
        </button>
      </Dialog>
      <Dialog
        open={startOpen}
        close={() => !busy && setStartOpen(false)}
        title="Start the draw"
      >
        <p>
          This revision will be locked. One randomness request selects both
          winners and alternates.
        </p>
        <div className="cost-lines">
          <div>
            <span>Lottewy</span>
            <strong>0 USDC</strong>
          </div>
          <div>
            <span>D20DAO quote</span>
            <strong>
              {pricing
                ? `${formatEther(BigInt(pricing.fee))} USDC`
                : "Calculating…"}
            </strong>
          </div>
          <div>
            <span>Maximum payment</span>
            <strong>
              {pricing
                ? `${formatEther(BigInt(pricing.value))} USDC`
                : "Calculating…"}
            </strong>
          </div>
          <div>
            <span>Estimated gas</span>
            <strong>{gas ? `${gas} USDC` : "Estimated by your wallet"}</strong>
          </div>
        </div>
        <p className="small muted">
          Overpayments are returned to you or become withdrawable credit. Gas is
          not refunded. Network: {arc.name}.
        </p>
        <button
          className="button lime full"
          disabled={busy || !pricing}
          onClick={start}
        >
          Sign, lock and confirm in wallet
        </button>
      </Dialog>
    </>
  );
}
export function Admin({ user, run, busy, mutate }: Common) {
  const [tab, setTab] = useState("reports"),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [target, setTarget] = useState<any>(null),
    [reason, setReason] = useState(""),
    [reviewChange, setReviewChange] = useState<boolean | null>(null),
    [reviewNote, setReviewNote] = useState("");
  const load = () =>
    api("/admin")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (user?.admin) load();
    else setData(null);
  }, [user?.address, user?.admin]);
  if (!user?.admin)
    return (
      <Empty icon={<LockKeyhole />} title="Admin access required">
        <p>This page is available only to server-authorized admin wallets.</p>
      </Empty>
    );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Content reviews, members and recorded actions.</p>
        </div>
      </div>
      {data?.settings && (
        <section
          className="admin-review-setting"
          aria-labelledby="review-setting-title"
        >
          <div>
            <h2 id="review-setting-title">Content review</h2>
            <p>
              {data.settings.jevEnabled
                ? "JEV and the local content filter are active."
                : "JEV is off. The local content filter is active."}
            </p>
            <p className="muted small">
              The local blacklist catches known wording; it does not provide
              JEV’s contextual review. Funding and anti-bot checks stay active.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setReviewChange(!data.settings.jevEnabled);
              setReviewNote("");
            }}
          >
            {data.settings.jevEnabled ? "Turn off JEV" : "Turn on JEV"}
          </button>
        </section>
      )}
      <div className="tabs">
        {[
          ["reports", "Reports"],
          ["members", "Members"],
          ["giveaways", "Giveaways"],
          ["actions", "Activity history"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="privacy-note small">
        Admins cannot change locked lists, random words or winners. Private
        entry data is not exposed here.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading…</p>
      ) : !data[tab].length ? (
        <Empty title="No records here yet">
          <p>New records will appear here.</p>
        </Empty>
      ) : (
        <div className="admin-list">
          {data[tab].map((r: any) => (
            <article key={r.id || r.address || r.action_id}>
              <div>
                <strong>
                  {tab === "giveaways"
                    ? r.manifest?.title || "Content under review"
                    : tab === "members"
                      ? r.address
                      : tab === "reports"
                        ? r.reason
                        : r.action_type}
                </strong>
                <p>
                  {tab === "reports"
                    ? `${r.giveaway_id} · ${r.state}`
                    : tab === "members"
                      ? r.suspended
                        ? "Suspended"
                        : "Active"
                      : tab === "giveaways"
                        ? statuses[r.status]
                        : `${r.signer} · ${r.target}`}
                </p>
              </div>
              {tab !== "actions" && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setTarget(r);
                    setReason("");
                  }}
                >
                  {tab === "reports"
                    ? "Review"
                    : tab === "members"
                      ? r.suspended
                        ? "Restore access"
                        : "Suspend"
                      : r.hidden
                        ? "Restore content"
                        : "Restrict content"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={!!target}
        close={() => setTarget(null)}
        title="Record an admin action"
      >
        <label>
          Review note
          <textarea
            minLength={10}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p>This action is signed by your wallet and added to the audit log.</p>
        <button
          className="button primary"
          disabled={busy || reason.trim().length < 10}
          onClick={() =>
            run(async () => {
              await mutate(
                tab === "reports"
                  ? "resolve-report"
                  : tab === "members"
                    ? "suspend"
                    : "moderate",
                target.id || target.address,
                target.revision || 0,
                {
                  reason,
                  ...(tab === "members"
                    ? { suspended: !target.suspended }
                    : tab === "giveaways"
                      ? { hidden: !target.hidden }
                      : {}),
                },
              );
              setTarget(null);
              await load();
            })
          }
        >
          Sign and apply
        </button>
      </Dialog>
      <Dialog
        open={reviewChange !== null}
        close={() => {
          if (!busy) setReviewChange(null);
        }}
        title={reviewChange ? "Turn on JEV" : "Turn off JEV"}
      >
        <p>
          {reviewChange
            ? "New saves will pass both the local filter and JEV review."
            : "New saves will use the local blacklist only. Contextual JEV review will be disabled."}
        </p>
        <label htmlFor="review-setting-note">Reason for this change</label>
        <textarea
          id="review-setting-note"
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          minLength={10}
          maxLength={1000}
          rows={3}
        />
        <p className="field-help">
          Your wallet signature and reason will be recorded in the admin
          activity log.
        </p>
        <button
          className="button primary"
          disabled={busy || reviewNote.trim().length < 10}
          onClick={() =>
            run(async () => {
              await mutate("set-jev", "jev_enabled", data.settings.revision, {
                enabled: reviewChange,
                reason: reviewNote,
              });
              setReviewChange(null);
              await load();
            })
          }
        >
          {busy ? "Waiting for signature…" : "Sign and apply"}
        </button>
      </Dialog>
    </>
  );
}
