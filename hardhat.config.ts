import { defineConfig } from "hardhat/config";
export default defineConfig({
  solidity: "0.8.28",
  networks: {
    local: { type: "edr-simulated", chainId: 5042002, hardfork: "cancun" },
  },
});
