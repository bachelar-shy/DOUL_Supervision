import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: resolve(process.cwd(), "tests_browser"),
  testMatch: ["payment-closed-loop.spec.ts"],
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5193",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: "list",
  webServer: {
    command: `${resolve(process.cwd(), "node_modules/.bin/vite")} --host 127.0.0.1 --port 5193 --strictPort`,
    url: "http://127.0.0.1:5193",
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: resolve(process.cwd(), "apps/web"),
    env: { VITE_DOUL_UI_SCOPE: "full" },
  },
});
