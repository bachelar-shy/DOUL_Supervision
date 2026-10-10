import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_browser_sample",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL: process.env.DOUL_SAMPLE_BASE_URL ?? "http://127.0.0.1:5187",
    browserName: "chromium",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
  },
});
