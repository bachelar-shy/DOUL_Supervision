import { defineConfig } from "@playwright/test";

const browserOrigin = "http://127.0.0.1:5382";
const apiOrigin = "http://127.0.0.1:8892";
const python = process.env.DOUL_TEST_PYTHON ?? ".venv/bin/python";

export default defineConfig({
  testDir: "./tests_browser",
  testMatch: "ux-200-full-journey.spec.ts",
  fullyParallel: false,
  workers: 1,
  maxFailures: 0,
  retries: 0,
  timeout: 60_000,
  outputDir: "test-results/ux200",
  reporter: [["list"], ["json", { outputFile: ".local/ux200-playwright-results.json" }]],
  use: {
    baseURL: browserOrigin,
    browserName: "chromium",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    launchOptions: process.env.DOUL_TEST_CHROMIUM
      ? { executablePath: process.env.DOUL_TEST_CHROMIUM }
      : undefined,
  },
  webServer: [
    {
      command: `"${python}" -m services.api --demo --database .local/ux200-review.sqlite3 --port 8892`,
      url: `${apiOrigin}/health`,
      reuseExistingServer: false,
      env: { DOUL_API_ALLOWED_ORIGINS: `http://127.0.0.1:5181,${browserOrigin}` },
      timeout: 30_000,
    },
    {
      command: "npm run dev --workspace apps/web -- --host 127.0.0.1 --port 5382 --strictPort",
      url: browserOrigin,
      reuseExistingServer: false,
      env: { DOUL_TEST_API_TARGET: apiOrigin, VITE_DOUL_UI_SCOPE: "full" },
      timeout: 30_000,
    },
  ],
});
