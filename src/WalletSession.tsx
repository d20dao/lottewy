import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createAuthenticationAdapter,
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
  lightTheme,
  type AvatarComponent,
} from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { getAccount } from "@wagmi/core";
import { useAccount } from "wagmi";
import { parseSiweMessage } from "viem/siwe";
import type { Address } from "viem";
import { walletConfig } from "./wallet-config";
import { api } from "./api";
import { assert, CHAIN_ID } from "../shared/core";
import { clearWalletDrafts } from "./editor-draft";
type User = { address: Address; admin: boolean; suspended: number };
const Context = createContext<{ user: User | null; authReady: boolean }>({
  user: null,
  authReady: false,
});
const baseTheme = lightTheme({
  accentColor: "#b5e95b",
  accentColorForeground: "#1c2411",
  borderRadius: "small",
  fontStack: "system",
});
const walletTheme = {
  ...baseTheme,
  fonts: { body: '"DM Sans", sans-serif' },
  colors: {
    ...baseTheme.colors,
    modalBackground: "#fafbf7",
    profileForeground: "#fafbf7",
    modalText: "#20271b",
    modalTextSecondary: "#748268",
    modalTextDim: "#7b876f",
    generalBorder: "#e0e6d7",
    modalBorder: "#dde4d2",
    profileAction: "#eff4e6",
    profileActionHover: "#e3edd5",
    actionButtonBorder: "#dce5cf",
    closeButtonBackground: "#edf1e6",
    closeButton: "#78866b",
    modalBackdrop: "rgba(26,35,19,0.35)",
  },
  radii: {
    ...baseTheme.radii,
    modal: "14px",
    modalMobile: "14px",
    menuButton: "8px",
    connectButton: "8px",
    actionButton: "8px",
  },
  shadows: {
    ...baseTheme.shadows,
    connectButton: "none",
    profileDetailsAction: "none",
    walletLogo: "none",
    dialog: "0 20px 70px rgba(25,35,15,0.16)",
  },
  blurs: { modalOverlay: "blur(3px)" },
};
const WalletAvatar: AvatarComponent = ({ ensImage, size }) =>
  ensImage ? (
    <img
      src={ensImage}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: "50%" }}
    />
  ) : (
    <span
      className="wallet-avatar"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Wallet size={Math.min(30, size * 0.44)} strokeWidth={1.45} />
    </span>
  );
export const useWalletSession = () => useContext(Context);
export default function WalletSession({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  const prior = useRef(address),
    challenge = useRef<{
      nonce: string;
      message: string;
      address: Address;
    } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api("/auth/me");
      setUser((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    } catch {
      // A network failure is not proof that the authenticated session ended.
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 300000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      prior.current &&
      prior.current.toLowerCase() !== address?.toLowerCase()
    ) {
      clearWalletDrafts(prior.current);
      setUser(null);
      challenge.current = null;
      void api("/auth/logout", {}).catch(() => {});
    }
    prior.current = address;
  }, [address]);
  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          const account = getAccount(walletConfig);
          assert(account.address, "Connect a wallet first");
          const c = await api("/auth/challenge", { address: account.address });
          challenge.current = { ...c, address: account.address };
          return c.nonce;
        },
        createMessage: ({ nonce, address, chainId }) => {
          const c = challenge.current;
          assert(
            c &&
              c.nonce === nonce &&
              c.address.toLowerCase() === address.toLowerCase() &&
              chainId === CHAIN_ID,
            "Wallet or network changed. Please try again.",
          );
          return c.message;
        },
        verify: async ({ message, signature }) => {
          try {
            const { nonce, address } = parseSiweMessage(message),
              current = getAccount(walletConfig);
            assert(
              address &&
                current.address?.toLowerCase() === address.toLowerCase(),
              "Wallet changed",
            );
            await api("/auth/verify", { nonce, signature });
            if (
              getAccount(walletConfig).address?.toLowerCase() !==
              address.toLowerCase()
            ) {
              await api("/auth/logout", {});
              return false;
            }
            await refresh();
            return true;
          } catch {
            return false;
          }
        },
        signOut: async () => {
          clearWalletDrafts(getAccount(walletConfig).address);
          setUser(null);
          challenge.current = null;
          await api("/auth/logout", {});
        },
      }),
    [refresh],
  );
  const activeUser =
    user && address?.toLowerCase() === user.address ? user : null;
  return (
    <Context.Provider value={{ user: activeUser, authReady: ready }}>
      <RainbowKitAuthenticationProvider
        adapter={adapter}
        status={
          !ready ? "loading" : activeUser ? "authenticated" : "unauthenticated"
        }
      >
        <RainbowKitProvider
          locale="en-US"
          theme={walletTheme}
          avatar={WalletAvatar}
        >
          {children}
        </RainbowKitProvider>
      </RainbowKitAuthenticationProvider>
    </Context.Provider>
  );
}
