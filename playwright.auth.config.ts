import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_browser",
  testMatch: ["password-auth-flow.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5195",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: "npm --workspace apps/web run dev -- --port 5195 --strictPort",
    env: { VITE_DOUL_AUTH_MODE: "password" },
    url: "http://127.0.0.1:5195",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
