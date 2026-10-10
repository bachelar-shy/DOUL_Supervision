import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: resolve(process.cwd(), "tests_browser"),
  testMatch: ["mock-site-photo-usability.spec.ts"],
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:5194",
    browserName: "chromium",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
  },
  reporter: "list",
  webServer: {
    command: `${resolve(process.cwd(), "node_modules/.bin/vite")} --host 127.0.0.1 --port 5194 --strictPort`,
    url: "http://127.0.0.1:5194",
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: resolve(process.cwd(), "apps/web"),
  },
});
