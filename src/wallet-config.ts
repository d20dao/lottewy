import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  rabbyWallet,
  phantomWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";
import { arc } from "../shared/chain";
export const walletConnectConfigured = !!import.meta.env
  .VITE_WALLETCONNECT_PROJECT_ID;
export const walletConfig = getDefaultConfig({
  appName: "Lottewy",
  projectId:
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "local-injected-only",
  chains: [arc],
  transports: { [arc.id]: http() },
  ...(walletConnectConfigured
    ? {}
    : {
        wallets: [
          {
            groupName: "Browser wallets",
            wallets: [injectedWallet, rabbyWallet, phantomWallet],
          },
        ],
      }),
});
