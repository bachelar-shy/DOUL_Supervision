import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_browser_quick_role",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "https://127.0.0.1:5210",
    browserName: "chromium",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1365, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
  ],
  reporter: "list",
  webServer: {
    command: ".venv/bin/python -m scripts.project_settings_browser_server",
    env: { DOUL_TEST_ROLE_LOGIN: "synthetic-only" },
    url: "https://127.0.0.1:5210/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
