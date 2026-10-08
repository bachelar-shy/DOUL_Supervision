import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// A unique SQLite path prevents one browser run from contaminating another.
const browserDatabase = join(tmpdir(), `doul-browser-${randomUUID()}.sqlite3`);
export default defineConfig({
  testDir: "./tests_browser",
  // UI Mock localization tests must not run against the live API fixture.
  testIgnore: ["localization.spec.ts"],
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
        `.venv/bin/python -m services.api --demo --database ${JSON.stringify(browserDatabase)} --port 8791`,
      url: "http://127.0.0.1:8791/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run web",
      url: "http://127.0.0.1:5181",
      reuseExistingServer: false,
    },
  ],
});
