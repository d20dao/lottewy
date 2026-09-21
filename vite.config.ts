import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: {
    __LOTTEWY_MAINNET__: JSON.stringify(
      process.env.LOTTEWY_NETWORK === "mainnet",
    ),
  },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    watch: {
      ignored: ["**/artifacts/**", "**/test-results/**", "**/.wrangler/**"],
    },
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
