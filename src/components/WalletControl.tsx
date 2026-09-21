import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";
import { arc } from "../../shared/chain";
export default function WalletControl() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        authenticationStatus,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted && authenticationStatus !== "loading",
          connected =
            ready &&
            account &&
            chain &&
            authenticationStatus === "authenticated";
        if (ready && chain?.unsupported)
          return (
            <button
              className="button secondary wallet-switch"
              onClick={openChainModal}
            >
              Switch to {arc.name}
            </button>
          );
        if (!connected)
          return (
            <button
              className="button secondary wallet-connect"
              onClick={openConnectModal}
              disabled={!ready}
            >
              <Wallet size={17} />
              {account ? "Sign in" : "Connect wallet"}
            </button>
          );
        return (
          <div className="wallet-control">
            <button
              className="wallet-network"
              onClick={openChainModal}
              aria-label={`Connected to ${chain.name}. Open network menu`}
            >
              <span />
              {chain.name}
            </button>
            <button
              className="wallet-account"
              onClick={openAccountModal}
              aria-label={`Open account for ${account.address}`}
            >
              <Wallet size={16} />
              <span>{`${account.address.slice(0, 6)}…${account.address.slice(-4)}`}</span>
              <ChevronDown size={14} />
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
