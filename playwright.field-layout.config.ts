import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_browser_layout",
  fullyParallel: false,
  workers: 1,
  timeout: 150000,
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
    command: "VITE_DOUL_AUTH_MODE=password VITE_DOUL_UI_SCOPE=full npm run web:build && .venv/bin/python -m scripts.project_settings_browser_server",
    env: {
      DOUL_TEST_ROLE_LOGIN: "synthetic-only",
      VITE_DOUL_UI_SCOPE: "full",
      VITE_DOUL_AUTH_MODE: "password",
    },
    url: "https://127.0.0.1:5210/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
