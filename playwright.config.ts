import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests_browser",
  testIgnore: ["localization-mock.spec.ts", "authoring-localization-mock.spec.ts", "password-auth-flow.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5181",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["json", { outputFile: ".local/browser-results.json" }]],
  webServer: [
    {
      command:
        ".venv/bin/python -m services.api --demo --database .local/browser-demo.sqlite3 --port 8791",
      url: "http://127.0.0.1:8791/health",
      reuseExistingServer: true,
    },
    {
      command: "npm run web",
      url: "http://127.0.0.1:5181",
      reuseExistingServer: true,
    },
  ],
});
