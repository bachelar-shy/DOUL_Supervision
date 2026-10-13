import { defineConfig } from "@playwright/test";
const isWindows = process.platform === "win32";
const python = process.env.DOUL_FW_TEST_PYTHON || (isWindows ? "py" : ".venv/bin/python");

export default defineConfig({
  testDir: "./tests_browser_fieldwire",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:5181",
    browserName: "chromium",
    ...(isWindows ? { channel: "chrome" as const } : {}),
    viewport: { width: 1365, height: 900 },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1365, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  reporter: "list",
  webServer: [
    {
      command: `${python} -m services.api --demo --port 8791 --database .local/fw-five-browser.sqlite3`,
      url: "http://127.0.0.1:8791/ready",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PYTHONUTF8: "1" },
    },
    {
      command: "node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port 5181",
      url: "http://127.0.0.1:5181",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DOUL_TEST_API_TARGET: "http://127.0.0.1:8791", VITE_DOUL_UI_SCOPE: "full" },
    },
  ],
});
