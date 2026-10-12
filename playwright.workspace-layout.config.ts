import { defineConfig } from "@playwright/test";

/** Isolated UI Mock runner: no live API, no shared database or Mac mini. */
export default defineConfig({
  testDir: "./tests_browser_layout",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5217",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: "npm run web:mock -- --port 5217 --strictPort",
    env: { VITE_DOUL_UI_SCOPE: "full" },
    url: "http://127.0.0.1:5217",
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
