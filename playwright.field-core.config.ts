import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests_browser_launch",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5198",
    browserName: "chromium",
  },
  reporter: "list",
  webServer: {
    command: "npm run web:mock -- --host 127.0.0.1 --port 5198",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
    // Exercise the real default, rather than forcing the desired scope.
    env: { VITE_DOUL_UI_SCOPE: "" },
    timeout: 30000,
  },
});
