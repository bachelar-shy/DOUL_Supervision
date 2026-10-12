import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests_browser_sheets",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "https://127.0.0.1:5210",
    browserName: "chromium",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
  reporter: "list",
  webServer: {
    command: "VITE_DOUL_AUTH_MODE=password npm run web:build && .venv/bin/python -m scripts.project_settings_browser_server",
    env: { DOUL_TEST_ROLE_LOGIN: "synthetic-only" },
    url: "https://127.0.0.1:5210/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 35000,
  },
});
