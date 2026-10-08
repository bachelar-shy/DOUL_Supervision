import { defineConfig } from "@playwright/test";

// Isolated UI-localization smoke suite. It must not reuse another worktree's
// Python venv, demo database, or active web server.
export default defineConfig({
  testDir: "./tests_browser",
  testMatch: "localization-mock.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5192",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: {
    command: "npm run web:mock -- --port 5192 --strictPort",
    url: "http://127.0.0.1:5192",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
