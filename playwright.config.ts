import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "msedge",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "list",
  timeout: 30000,
  workers: 1,
});
