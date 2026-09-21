import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Users,
} from "lucide-react";
import { api } from "./api";
import { hash } from "../shared/core";
import {
  normalizeDiscordCampaign,
  type DiscordCampaignInput,
} from "../shared/discord-campaign";
import { Collapsible, Dialog, Empty } from "./components/primitives";
import TurnstileWidget from "./components/TurnstileWidget";
import "./discord.css";
type Props = {
  user: { address: string } | null;
  config: any;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  mutate: (
    type: string,
    id: string,
    revision: number,
    payload: unknown,
    progress?: (value: string) => void,
    checks?: { turnstileToken?: string },
  ) => Promise<any>;
  notify: (value: string) => void;
  onLogin: () => void;
};
type Link = {
  id: string;
  guildName: string;
  channelName: string;
  verifiedAt: number;
};
type VerificationChallenge = {
  code: string;
  nonceRef: string;
  expires: number;
  installUrl: string;
  owner?: string;
};
const challengeKey = (owner: string) =>
  `lottewy:editor:v1:${owner.toLowerCase()}:discord-verification`;
function savedChallenge(
  owner: string | undefined,
): VerificationChallenge | null {
  if (!owner) return null;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(challengeKey(owner)) || "null",
    );
    return value?.owner === owner.toLowerCase() &&
      typeof value.code === "string" &&
      typeof value.nonceRef === "string" &&
      Number.isFinite(value.expires)
      ? value
      : null;
  } catch {
    return null;
  }
}
function DiscordEnvironmentGate({ origin }: { origin: string }) {
  return (
    <Empty title="Discord setup is available on testnet.">
      <p>
        Continue on testnet to connect your server and run Discord giveaways.
        You’ll sign in again on testnet.
      </p>
      <a className="button lime" href={origin + "/create?mode=discord"}>
        Continue on testnet <ArrowRight size={16} />
      </a>
    </Empty>
  );
}
type Campaign = {
  id: string;
  owner: string;
  revision: number;
  status: string;
  title: string;
  description: string;
  rules: string;
  winners: number;
  reserves: number;
  endsAt: number;
  participantCount: number;
  payloadHash: string;
  giveawayId: string | null;
  errorCode: string | null;
  messageUrl: string | null;
  messageRecoveryRequired?: boolean;
  roleIds?: string[];
};
const names: Record<string, string> = {
  publishing: "Publishing to Discord",
  publishing_uncertain: "Check message delivery",
  open: "Registration open",
  closing: "Preparing the final list",
  ready: "Registration closed",
  insufficient: "Not enough participants",
  cancelled: "Registration cancelled",
  expired: "Registration expired",
};
const localTime = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const storageKey = (owner: string) =>
  `lottewy:editor:v1:${owner.toLowerCase()}:discord-campaign`;
const initial = (owner: string) => {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(storageKey(owner)) || "null",
    );
    if (saved?.owner === owner.toLowerCase()) return saved;
  } catch {}
  return {
    owner: owner.toLowerCase(),
    id: crypto.randomUUID(),
    title: "",
    description: "",
    rules: "",
    winners: "1",
    reserves: "0",
    ends: localTime(Date.now() + 3600000),
    listed: false,
    linkId: "",
    roleIds: [],
    channelId: "",
    detailsOpen: false,
  };
};
const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function DiscordCreator(props: Props) {
  const { user, config, busy, run, mutate, notify, onLogin } = props;
  const [form, setForm] = useState(() => initial(user?.address || "guest")),
    [links, setLinks] = useState<Link[]>([]),
    [roles, setRoles] = useState<{ id: string; name: string }[]>([]),
    [rolesError, setRolesError] = useState(""),
    [rolesLoading, setRolesLoading] = useState(false),
    [channels, setChannels] = useState<{ id: string; name: string }[]>([]),
    [channelsLoading, setChannelsLoading] = useState(false),
    [channelsError, setChannelsError] = useState(""),
    [roleRetry, setRoleRetry] = useState(0),
    [challenge, setChallenge] = useState<VerificationChallenge | null>(() =>
      savedChallenge(user?.address.toLowerCase()),
    ),
    [challengeExpired, setChallengeExpired] = useState(false),
    [roleSearch, setRoleSearch] = useState(""),
    [error, setError] = useState(""),
    [reviewing, setReviewing] = useState(false),
    [phase, setPhase] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [reset, setReset] = useState(0);
  const owner = user?.address.toLowerCase(),
    identity = useRef(owner),
    heading = useRef<HTMLHeadingElement>(null);
  identity.current = owner;
  useEffect(() => setRoleSearch(""), [owner, form.linkId]);
  useEffect(() => {
    if (!owner || form.owner !== owner) return;
    try {
      if (challenge?.owner === owner)
        sessionStorage.setItem(challengeKey(owner), JSON.stringify(challenge));
      else if (!challenge) sessionStorage.removeItem(challengeKey(owner));
    } catch {}
  }, [challenge, owner, form.owner]);
  useEffect(() => {
    setChallengeExpired(!!challenge && challenge.expires * 1000 <= Date.now());
    if (!challenge) return;
    const timer = setTimeout(
      () => setChallengeExpired(true),
      Math.max(0, challenge.expires * 1000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [challenge]);
  useEffect(() => {
    let live = true;
    setChannels([]);
    setChannelsError("");
    if (!owner || !form.linkId) {
      setChannelsLoading(false);
      return;
    }
    setChannelsLoading(true);
    api<{ id: string; name: string }[]>(
      "/discord/links/" + form.linkId + "/channels",
    )
      .then((rows) => {
        if (live) setChannels(rows);
      })
      .catch((e) => {
        if (live) setChannelsError(e.message);
      })
      .finally(() => {
        if (live) setChannelsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [owner, form.linkId, roleRetry]);
  useEffect(() => {
    let live = true;
    setRoles([]);
    setRolesError("");
    if (!owner || !form.linkId) {
      setRolesLoading(false);
      return;
    }
    setRolesLoading(true);
    api<{ id: string; name: string }[]>(
      "/discord/links/" + form.linkId + "/roles",
    )
      .then((rows) => {
        if (live) setRoles(rows);
      })
      .catch((e) => {
        if (live) setRolesError(e.message);
      })
      .finally(() => {
        if (live) setRolesLoading(false);
      });
    return () => {
      live = false;
    };
  }, [owner, form.linkId, roleRetry]);
  useEffect(() => {
    setForm(initial(owner || "guest"));
    setLinks([]);
    setChallenge(savedChallenge(owner));
    setReviewing(false);
    setToken(null);
    setError("");
  }, [owner]);
  useEffect(() => {
    if (owner && form.owner === owner)
      try {
        sessionStorage.setItem(storageKey(owner), JSON.stringify(form));
      } catch {}
  }, [form, owner]);
  useEffect(() => {
    if (
      !owner ||
      !config?.discordConfigured ||
      (config.discordSetupOrigin &&
        config.discordSetupOrigin !== location.origin)
    )
      return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const [rows, status] = await Promise.all([
          api<Link[]>("/discord/links"),
          challenge
            ? api<{ linkId: string | null }>(
                "/discord/verification/" + challenge.nonceRef,
              )
            : Promise.resolve(null),
        ]);
        if (live) {
          setLinks(rows);
          if (!challenge && rows.length === 1)
            setForm((current: any) =>
              current.linkId
                ? current
                : {
                    ...current,
                    linkId: rows[0].id,
                    channelId: "",
                    roleIds: [],
                  },
            );
          if (status?.linkId && rows.some((r) => r.id === status.linkId)) {
            setForm((current: any) => ({
              ...current,
              linkId: status.linkId,
              roleIds: current.linkId === status.linkId ? current.roleIds : [],
              channelId:
                current.linkId === status.linkId ? current.channelId : "",
              detailsOpen: false,
            }));
            setChallenge(null);
            notify("Server verified. Choose the giveaway channel.");
          }
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live && challenge && Date.now() < challenge.expires * 1000)
          timer = setTimeout(load, 3000);
      }
    };
    void load();
    const focus = () => {
      clearTimeout(timer);
      void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [owner, config?.discordConfigured, challenge?.code]);
  const field = (name: string, value: unknown) => {
    if (name === "linkId") setChallenge(null);
    setForm((current: any) => ({
      ...current,
      [name]: value,
      ...(name === "linkId"
        ? { roleIds: [], channelId: "", detailsOpen: false, limitRoles: false }
        : {}),
      ...(name === "limitRoles" && !value ? { roleIds: [] } : {}),
    }));
    setError("");
  };
  function details() {
    const d = normalizeDiscordCampaign({
      title: form.title,
      description: form.description,
      rules: form.rules,
      winners: Number(form.winners),
      reserves: Number(form.reserves),
      listed: form.listed,
      linkId: form.linkId,
      endsAt: Math.floor(new Date(form.ends).getTime() / 1000),
      roleIds: form.roleIds || [],
      channelId: form.channelId,
    });
    const now = Math.floor(Date.now() / 1000);
    if (d.endsAt < now + 120 || d.endsAt > now + 30 * 86400)
      throw new Error(
        "Choose a closing time between 2 minutes and 30 days from now.",
      );
    return d;
  }
  const review = (event: FormEvent) => {
    event.preventDefault();
    try {
      details();
      setReviewing(true);
      setError("");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const verify = () =>
    run(async () => {
      const current = owner;
      setError("");
      try {
        const result = await api("/discord/challenge", {});
        if (identity.current === current)
          setChallenge({ ...result, owner: current });
      } catch (e) {
        if (identity.current === current) setError((e as Error).message);
      }
    });
  const publish = () =>
    run(async () => {
      const current = owner;
      setError("");
      try {
        const d = details();
        if (config.turnstileSiteKey && !token)
          throw new Error("Complete the verification before publishing.");
        let saved: Campaign | undefined;
        try {
          saved = await api(`/discord/campaigns/${form.id}`);
        } catch (e) {
          if ((e as any).status !== 404) throw e;
        }
        if (saved && (saved.owner !== current || saved.payloadHash !== hash(d)))
          throw new Error(
            "This registration was already saved. Open Discord registrations to manage it, or start a separate registration with these details.",
          );
        const result =
          saved ||
          (await mutate("discordCreate", form.id, 0, d, setPhase, {
            turnstileToken: token || undefined,
          }));
        if (identity.current !== current) return;
        sessionStorage.removeItem(storageKey(owner!));
        location.assign("/discord/" + result.id);
      } catch (e) {
        if (identity.current === current) setError((e as Error).message);
      } finally {
        setPhase("");
        setToken(null);
        setReset((n) => n + 1);
      }
    });
  if (
    config?.discordSetupOrigin &&
    config.discordSetupOrigin !== location.origin
  )
    return <DiscordEnvironmentGate origin={config.discordSetupOrigin} />;
  if (!user)
    return (
      <Empty title="Connect a wallet to organize a Discord giveaway">
        <p>
          Your wallet owns the giveaway and starts the draw after registration
          closes.
        </p>
        <button className="button primary" onClick={onLogin}>
          Connect wallet
        </button>
      </Empty>
    );
  if (form.owner !== owner)
    return (
      <Empty title="Switching wallet…">
        <p>Loading your registration draft.</p>
      </Empty>
    );
  if (!config) return <p className="loading">Loading Discord setup…</p>;
  if (!config.discordConfigured)
    return (
      <Empty title="Discord registration is not enabled yet">
        <p>
          The bot and its interaction endpoint must be configured on this
          deployment.
        </p>
        <a className="button secondary" href="/create">
          Use a list or CSV
        </a>
      </Empty>
    );
  const selected = links.find((link) => link.id === form.linkId);
  const limitRoles = form.limitRoles ?? !!form.roleIds?.length;
  const missingRoles =
    !rolesLoading &&
    !rolesError &&
    (form.roleIds || []).some((id: string) => !roles.some((r) => r.id === id));
  return (
    <div className="discord-creator">
      <a className="back" href="/discord">
        <ArrowLeft size={16} /> My Discord registrations
      </a>
      <div className="page-head">
        <div>
          <p className="eyebrow">DISCORD REGISTRATION</p>
          <h1 ref={heading} tabIndex={-1}>
            {reviewing
              ? "Review the announcement."
              : form.detailsOpen
                ? "Set the giveaway details."
                : "Let your community join."}
          </h1>
          <p>
            Collect entries in Discord. Start the verifiable draw from your
            wallet when registration closes.
          </p>
        </div>
      </div>
      {!reviewing ? (
        <form
          onSubmit={review}
          className="discord-creator-grid"
          data-stage={form.detailsOpen ? "details" : "setup"}
        >
          {!form.detailsOpen && (
            <section
              className="discord-channel-setup"
              aria-labelledby="discord-channel-heading"
            >
              <h2 id="discord-channel-heading">
                {links.length ? "Choose your server" : "1. Verify your server"}
              </h2>
              {!links.length && (
                <p className="muted">
                  Run <code>/verify</code> in your Discord server with the
                  one-time code below. You need Manage Server permission. After
                  verification, choose where the giveaway appears.
                </p>
              )}
              {!!links.length && (
                <>
                  <label htmlFor="discord-server">Verified server</label>
                  <select
                    id="discord-server"
                    value={form.linkId}
                    onChange={(e) => field("linkId", e.target.value)}
                  >
                    <option value="">Choose a verified server</option>
                    {links.map((link) => (
                      <option key={link.id} value={link.id}>
                        {link.guildName}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={verify}
              >
                {challengeExpired
                  ? "Get a new code"
                  : links.length
                    ? "Connect another server"
                    : "Get verification code"}
              </button>
              {config.discordInstallUrl && (!links.length || challenge) && (
                <p className="small muted">
                  Missing the command?{" "}
                  <a
                    href={config.discordInstallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Add bot to Discord <ExternalLink size={14} />
                  </a>
                  , then return here.
                </p>
              )}
              <Collapsible open={!!challenge}>
                <div className="discord-verify-instructions">
                  <label htmlFor="discord-verification-code">
                    One-time code
                  </label>
                  <div className="discord-code">
                    <input
                      id="discord-verification-code"
                      value={challenge?.code || ""}
                      readOnly
                    />
                    <button
                      type="button"
                      className="button secondary"
                      aria-label="Copy verification command"
                      disabled={challengeExpired}
                      onClick={() =>
                        run(async () => {
                          await navigator.clipboard.writeText(
                            "/verify code:" + challenge!.code,
                          );
                          notify("Verification command copied.");
                        })
                      }
                    >
                      <Copy size={17} />
                    </button>
                  </div>
                  {challengeExpired ? (
                    <p role="status">
                      This code expired. Get a new code to continue.
                    </p>
                  ) : (
                    <p className="small muted">
                      Run <code>/verify code:{challenge?.code}</code> in
                      Discord. Waiting for Discord. This page updates
                      automatically. Expires{" "}
                      {challenge ? date(challenge.expires) : ""}.
                    </p>
                  )}
                </div>
              </Collapsible>
              {form.linkId && (
                <>
                  <h3 className="discord-step-heading">
                    2. Choose the giveaway channel
                  </h3>
                  <p className="small muted">
                    Only channels where the bot can view, send messages, embed
                    links and read message history are shown.
                  </p>
                  {channelsLoading ? (
                    <p role="status">Checking channel access…</p>
                  ) : channelsError ? (
                    <p role="alert">{channelsError}</p>
                  ) : channels.length ? (
                    <>
                      <label htmlFor="discord-channel">Giveaway channel</label>
                      <select
                        id="discord-channel"
                        value={form.channelId || ""}
                        onChange={(e) => field("channelId", e.target.value)}
                      >
                        <option value="">Choose a channel</option>
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <p role="status">
                      No accessible channels. Update the bot’s channel
                      permissions in Discord, then refresh.
                    </p>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={channelsLoading}
                    onClick={() => setRoleRetry((n) => n + 1)}
                  >
                    Refresh channel access
                  </button>
                </>
              )}
              {form.linkId && form.channelId && (
                <fieldset className="discord-role-filter">
                  <legend>Who can join?</legend>
                  <label className="discord-role-toggle">
                    <input
                      type="checkbox"
                      checked={limitRoles}
                      onChange={(e) => field("limitRoles", e.target.checked)}
                    />{" "}
                    Limit to specific roles
                  </label>
                  {!limitRoles ? (
                    <p className="small muted">
                      Anyone with channel access can join.
                    </p>
                  ) : (
                    <>
                      <p className="small muted">
                        No roles selected: anyone with channel access.
                        Otherwise, members need at least one selected role when
                        joining. Up to 10 roles.
                      </p>
                      {roles.length > 10 && (
                        <>
                          <label htmlFor="discord-role-search">
                            Find a role
                          </label>
                          <input
                            id="discord-role-search"
                            value={roleSearch}
                            onChange={(e) => setRoleSearch(e.target.value)}
                          />
                        </>
                      )}
                      <p className="small muted">
                        {(form.roleIds || []).length} of 10 roles selected.
                      </p>
                      {missingRoles && (
                        <p role="alert">
                          A selected role is no longer available.{" "}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              field(
                                "roleIds",
                                (form.roleIds || []).filter((id: string) =>
                                  roles.some((r) => r.id === id),
                                ),
                              )
                            }
                          >
                            Remove unavailable roles
                          </button>
                        </p>
                      )}
                      {rolesLoading ? (
                        <p role="status">Loading server roles…</p>
                      ) : rolesError ? (
                        <div>
                          <p role="alert">{rolesError}</p>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setRoleRetry((n) => n + 1)}
                          >
                            Retry loading roles
                          </button>
                        </div>
                      ) : (
                        <div className="discord-role-options">
                          {roles.length ? (
                            roles
                              .filter((role) =>
                                role.name
                                  .toLowerCase()
                                  .includes(roleSearch.toLowerCase()),
                              )
                              .map((role) => (
                                <label key={role.id}>
                                  <input
                                    type="checkbox"
                                    checked={(form.roleIds || []).includes(
                                      role.id,
                                    )}
                                    disabled={
                                      !(form.roleIds || []).includes(role.id) &&
                                      (form.roleIds || []).length >= 10
                                    }
                                    onChange={(e) =>
                                      field(
                                        "roleIds",
                                        e.target.checked
                                          ? [...(form.roleIds || []), role.id]
                                          : (form.roleIds || []).filter(
                                              (id: string) => id !== role.id,
                                            ),
                                      )
                                    }
                                  />
                                  <span>{role.name}</span>
                                </label>
                              ))
                          ) : (
                            <p className="small muted">
                              This server has no additional roles.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </fieldset>
              )}
              {form.channelId && (
                <>
                  <div className="discord-flow-note">
                    <Users size={20} />
                    <p>
                      One entry per Discord account. Members can join or leave
                      until the deadline. Afterwards, the list and rules are
                      fixed. Winners are announced in the same Discord message.
                      Undrawn registrations are cleaned up 30 days after
                      closing.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button lime full"
                    disabled={
                      busy ||
                      channelsLoading ||
                      (limitRoles &&
                        (rolesLoading ||
                          !!rolesError ||
                          missingRoles ||
                          !form.roleIds?.length)) ||
                      !!channelsError ||
                      !channels.some((c) => c.id === form.channelId)
                    }
                    onClick={() => {
                      field("detailsOpen", true);
                      requestAnimationFrame(() => heading.current?.focus());
                    }}
                  >
                    Continue to giveaway details <ArrowRight size={16} />
                  </button>
                </>
              )}
            </section>
          )}
          {form.detailsOpen && (
            <section className="discord-channel-setup">
              <h2>
                <Check size={20} /> Discord setup complete
              </h2>
              <p>
                {selected?.guildName} / #
                {channels.find((c) => c.id === form.channelId)?.name ||
                  form.channelId}
              </p>
              <p className="small muted">
                {form.roleIds?.length
                  ? form.roleIds
                      .map(
                        (id: string) =>
                          roles.find((r) => r.id === id)?.name || id,
                      )
                      .join(" or ")
                  : "Anyone with channel access"}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  field("detailsOpen", false);
                  requestAnimationFrame(() => heading.current?.focus());
                }}
              >
                Change server, channel or roles
              </button>
            </section>
          )}
          {form.detailsOpen && (
            <section className="discord-details" aria-label="Giveaway details">
              <label htmlFor="discord-title">Giveaway title</label>
              <input
                id="discord-title"
                value={form.title}
                minLength={3}
                maxLength={120}
                required
                onChange={(e) => field("title", e.target.value)}
              />
              <label htmlFor="discord-description">
                Description <span className="muted">(optional)</span>
              </label>
              <textarea
                id="discord-description"
                value={form.description}
                maxLength={4000}
                rows={3}
                onChange={(e) => field("description", e.target.value)}
              />
              <label htmlFor="discord-rules">Entry and prize rules</label>
              <textarea
                id="discord-rules"
                value={form.rules}
                minLength={5}
                maxLength={4000}
                rows={5}
                required
                onChange={(e) => field("rules", e.target.value)}
              />
              <div className="discord-counts">
                <div>
                  <label htmlFor="discord-winners">Winners</label>
                  <input
                    id="discord-winners"
                    type="number"
                    min={1}
                    max={100}
                    value={form.winners}
                    required
                    onChange={(e) => field("winners", e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="discord-alternates">Alternates</label>
                  <input
                    id="discord-alternates"
                    type="number"
                    min={0}
                    max={100}
                    value={form.reserves}
                    required
                    onChange={(e) => field("reserves", e.target.value)}
                  />
                </div>
              </div>
              <label htmlFor="discord-ends">
                Registration closes{" "}
                <span className="muted">(your local time)</span>
              </label>
              <input
                id="discord-ends"
                type="datetime-local"
                value={form.ends}
                required
                onChange={(e) => field("ends", e.target.value)}
              />
              <label className="discord-listing">
                <input
                  type="checkbox"
                  checked={form.listed}
                  onChange={(e) => field("listed", e.target.checked)}
                />{" "}
                List the final giveaway in Explorer
              </label>
              <p className="small muted">
                Discord entries have equal chances. If fewer than{" "}
                {Math.max(
                  2,
                  Number(form.winners || 0) + Number(form.reserves || 0),
                )}{" "}
                members join, the draw cannot start with these counts.
              </p>
              <button className="button lime full" disabled={busy}>
                Review registration <ArrowRight size={17} />
              </button>
            </section>
          )}
        </form>
      ) : (
        <section className="discord-review">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setReviewing(false);
              setToken(null);
            }}
          >
            <ArrowLeft size={16} /> Back to editing
          </button>
          <p className="eyebrow">ANNOUNCEMENT PREVIEW</p>
          <h2>{form.title}</h2>
          <p className="muted">
            {selected?.guildName} / #
            {channels.find((c) => c.id === form.channelId)?.name ||
              form.channelId}
          </p>
          {form.description && <p className="preserve">{form.description}</p>}
          <p className="preserve">{form.rules}</p>
          <dl className="discord-summary">
            <div>
              <dt>Required roles</dt>
              <dd>
                {form.roleIds?.length
                  ? form.roleIds
                      .map(
                        (id: string) =>
                          roles.find((r) => r.id === id)?.name || id,
                      )
                      .join(" or ")
                  : "Anyone with channel access"}
              </dd>
            </div>
            <div>
              <dt>Winners</dt>
              <dd>{form.winners}</dd>
            </div>
            <div>
              <dt>Alternates</dt>
              <dd>{form.reserves}</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{date(Math.floor(new Date(form.ends).getTime() / 1000))}</dd>
            </div>
            <div>
              <dt>Participation</dt>
              <dd>Join / Leave buttons · equal chances</dd>
            </div>
          </dl>
          <p>
            The bot posts the registration message after you sign. No onchain
            draw starts automatically. You pay the randomness fee and gas when
            you start the draw after closing.
          </p>
          {config.turnstileSiteKey && (
            <TurnstileWidget
              siteKey={config.turnstileSiteKey}
              resetKey={reset}
              onToken={setToken}
            />
          )}
          <button
            className="button lime full"
            disabled={busy || (!!config.turnstileSiteKey && !token)}
            onClick={publish}
          >
            {phase || "Sign and publish registration"} <ArrowRight size={17} />
          </button>
        </section>
      )}
      <p className="save-progress" role="status">
        {phase}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {error.startsWith("This registration was already saved.") && (
        <div className="actions wrap">
          <a className="button secondary" href={"/discord/" + form.id}>
            Open saved registration
          </a>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setForm((current: any) => ({
                ...current,
                id: crypto.randomUUID(),
              }));
              setReviewing(false);
              setError("");
            }}
          >
            Use details for a new registration
          </button>
        </div>
      )}
    </div>
  );
}

export function DiscordCampaignPage({ user, busy, run, mutate }: Props) {
  const id = location.pathname.split("/")[2],
    [campaign, setCampaign] = useState<Campaign | null>(null),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false),
    [messageId, setMessageId] = useState("");
  const load = async () => {
    const row = await api<Campaign>(`/discord/campaigns/${id}`);
    setCampaign(row);
    setError("");
  };
  useEffect(() => {
    let live = true,
      polling = true,
      inflight = false,
      timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      if (!live || inflight || document.visibilityState === "hidden") return;
      inflight = true;
      try {
        const { serverTime, ...row } = await api<
          Campaign & { serverTime: number }
        >(`/discord/campaigns/${id}`);
        if (live) {
          setCampaign((previous) =>
            JSON.stringify(previous) === JSON.stringify(row) ? previous : row,
          );
          setError("");
          polling = [
            "publishing",
            "publishing_uncertain",
            "open",
            "closing",
          ].includes(row.status);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        inflight = false;
        if (live && polling) timer = setTimeout(update, 5000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (polling && document.visibilityState === "visible") void update();
    };
    document.addEventListener("visibilitychange", visibility);
    void update();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id]);
  if (!campaign)
    return error ? (
      <Empty title="Registration unavailable">
        <p role="alert">{error}</p>
      </Empty>
    ) : (
      <p className="loading" role="status">
        Loading registration…
      </p>
    );
  const recovery = user?.address.toLowerCase() === campaign.owner &&
    campaign.messageRecoveryRequired && (
      <section className="discord-recovery">
        <h2>Check the announcement</h2>
        <p>
          Message delivery was uncertain. Lottewy will not send a second
          announcement. If it appeared in Discord, link that original message
          below.
        </p>
        <label htmlFor="discord-message-id">
          Original Discord message ID or link
        </label>
        <input
          id="discord-message-id"
          value={messageId}
          onChange={(e) => setMessageId(e.target.value)}
        />
        <button
          className="button secondary"
          disabled={busy || !messageId.trim()}
          onClick={() =>
            run(async () => {
              try {
                const value = messageId.trim(),
                  matched =
                    /^https:\/\/(?:discord.com|discordapp.com)\/channels\/\d+\/\d+\/(\d+)$/.exec(
                      value,
                    );
                await mutate("discordRecover", id, 1, {
                  messageId: matched?.[1] || value,
                });
                await load();
              } catch (e) {
                setError((e as Error).message);
              }
            })
          }
        >
          Link existing message
        </button>
      </section>
    );
  if (campaign.status === "expired")
    return (
      <>
        <Empty title="Registration expired">
          <p>
            No draw was started within 30 days of closing. The participant list
            and undrawn draft have been removed.
          </p>
        </Empty>
        {recovery}
        {error && <p role="alert">{error}</p>}
      </>
    );
  if (campaign.status === "hidden")
    return (
      <Empty title="Content under review">
        <p>This registration is not publicly available.</p>
      </Empty>
    );
  const owner = user?.address.toLowerCase() === campaign.owner,
    canCancel =
      owner &&
      ["publishing", "publishing_uncertain", "open", "insufficient"].includes(
        campaign.status,
      );
  return (
    <div className="discord-campaign-page">
      <a className="back" href={owner ? "/discord" : "/explorer"}>
        <ArrowLeft size={16} />{" "}
        {owner ? "My Discord registrations" : "Public giveaways"}
      </a>
      <div className="page-head">
        <div>
          <p className="eyebrow">DISCORD GIVEAWAY</p>
          <h1>{campaign.title}</h1>
          <p>Organized by {campaign.owner}</p>
        </div>
        <span className="badge">
          <span />
          {names[campaign.status] || campaign.status}
        </span>
      </div>
      <dl className="discord-summary">
        <div>
          <dt>Entries</dt>
          <dd>{campaign.participantCount}</dd>
        </div>
        <div>
          <dt>Winners</dt>
          <dd>{campaign.winners}</dd>
        </div>
        <div>
          <dt>Alternates</dt>
          <dd>{campaign.reserves}</dd>
        </div>
        <div>
          <dt>Registration closes</dt>
          <dd>{date(campaign.endsAt)}</dd>
        </div>
      </dl>
      {campaign.description && (
        <p className="preserve">{campaign.description}</p>
      )}
      <h2>Entry and prize rules</h2>
      <p className="preserve">{campaign.rules}</p>
      <p className="muted">
        Participation happens in the verified Discord channel. One Discord
        account gets one entry; no wallet is required to join. The organizer
        starts the draw and delivers any prizes.
      </p>
      {!!campaign.roleIds?.length && (
        <p>
          Required roles (at least one): {campaign.roleIds.join(", ")}. Roles
          are checked when joining.
        </p>
      )}
      <div className="actions wrap">
        {campaign.messageUrl && (
          <a
            className="button secondary"
            href={campaign.messageUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Discord <ExternalLink size={16} />
          </a>
        )}
        {campaign.giveawayId && (
          <a className="button lime" href={"/g/" + campaign.giveawayId}>
            Open the giveaway <ArrowRight size={17} />
          </a>
        )}
        {canCancel && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setCancel(true)}
          >
            Cancel registration
          </button>
        )}
      </div>
      {campaign.status === "insufficient" && (
        <p role="status">
          Registration closed with too few entries for the announced counts. No
          draw has started. The list cannot be changed.
        </p>
      )}
      {campaign.errorCode === "DISCORD_RATE_LIMITED" && (
        <p role="status">
          Discord is temporarily busy. Lottewy will retry automatically.
        </p>
      )}
      {recovery}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={cancel}
        close={() => setCancel(false)}
        title="Cancel this registration?"
      >
        <p>
          Members will no longer be able to join. No draw will start; the
          recorded entries remain in its history.
        </p>
        <div className="actions wrap">
          <button className="button secondary" onClick={() => setCancel(false)}>
            Keep registration
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                try {
                  await mutate("discordCancel", id, 1, {});
                  setCancel(false);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              })
            }
          >
            Cancel registration
          </button>
        </div>
      </Dialog>
    </div>
  );
}

export function DiscordCampaignList({ user, onLogin, config }: Props) {
  const [rows, setRows] = useState<Campaign[] | null>(null),
    [rowsOwner, setRowsOwner] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setError("");
    if (user)
      api<Campaign[]>("/discord/campaigns")
        .then((result) => {
          if (live) {
            setRows(result);
            setRowsOwner(user.address);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [user?.address]);
  if (
    config?.discordSetupOrigin &&
    config.discordSetupOrigin !== location.origin
  )
    return <DiscordEnvironmentGate origin={config.discordSetupOrigin} />;
  if (!user)
    return (
      <Empty title="Sign in to see your Discord registrations">
        <button className="button primary" onClick={onLogin}>
          Connect wallet
        </button>
      </Empty>
    );
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">COMMUNITY ENTRIES</p>
          <h1>Discord registrations.</h1>
          <p>
            Collect entries first. Review the fixed list and start the draw
            after closing.
          </p>
        </div>
        <a className="button lime" href="/create?mode=discord">
          New registration <ArrowRight size={17} />
        </a>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !rows || rowsOwner !== user.address ? (
        <p className="loading">Loading registrations…</p>
      ) : !rows.length ? (
        <Empty title="No Discord registrations yet">
          <p>
            Verify a server channel to let your community join with a button.
          </p>
          <div className="actions wrap">
            {config?.discordInstallUrl && (
              <a
                className="button secondary"
                href={config.discordInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Add bot to Discord <ExternalLink size={16} />
              </a>
            )}
            <a className="button lime" href="/create?mode=discord">
              Set up a Discord giveaway <ArrowRight size={16} />
            </a>
          </div>
        </Empty>
      ) : (
        <div className="discord-registration-list">
          {rows.map((row) => (
            <a
              key={row.id}
              href={"/discord/" + row.id}
              className="discord-registration-row"
            >
              <div>
                <h2>{row.title}</h2>
                <p>
                  {row.participantCount} entries · closes {date(row.endsAt)}
                </p>
              </div>
              <span>
                {names[row.status] || row.status} <ArrowRight size={16} />
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
