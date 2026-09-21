import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletConfig } from "./wallet-config";
import WalletSession from "./WalletSession";
import App from "./App";
import "@rainbow-me/rainbowkit/styles.css";
import "./styles.css";
const queryClient = new QueryClient();
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="error-page">
        <h1>Could not load this page.</h1>
        <p>Check your connection and try again.</p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletSession>
          <App />
        </WalletSession>
      </QueryClientProvider>
    </WagmiProvider>
  </Boundary>,
);

import "./editor.css";

import "./reveal.css";

import './verification.css';

import './wallet.css';
