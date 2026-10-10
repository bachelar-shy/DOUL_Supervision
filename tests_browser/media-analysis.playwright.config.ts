import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "media-analysis-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5184",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
  webServer: [{
    command: "../../node_modules/.bin/vite --port 5184 --strictPort",
    cwd: "/tmp/doul-media-analysis-browser-v1/apps/web",
    url: "http://127.0.0.1:5184",
    reuseExistingServer: false,
  }],
});
