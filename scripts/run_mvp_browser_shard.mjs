/** Full-coverage, non-empty MVP browser shard runner.
 * Playwright built-in file-sharding can produce empty success jobs when one
 * spec contains 200 cases. Use an explicit stable round-robin FILE partition.
 * Never split a file with beforeAll/afterAll or its own 200-case audit.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const index = Number(process.argv[2]);
const total = Number(process.argv[3]);
if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 1 || index > total) {
  throw new Error("Usage: node scripts/run_mvp_browser_shard.mjs <1-based-index> <total-shards>");
}

const dir = join(process.cwd(), "tests_browser");
const ignored = new Set(["authoring-localization-mock.spec.ts", "localization-mock.spec.ts", "password-auth-flow.spec.ts"]);
const all = readdirSync(dir).filter(name => name.endsWith(".spec.ts") && !ignored.has(name)).sort();
const selected = all.filter((_, position) => position % total === index - 1);
if (all.length < total || selected.length === 0) {
  throw new Error(`Browser shard ${index}/${total}: zero selected tests or fewer spec files than shards`);
}
const selectedPaths = selected.map(name => `tests_browser/${name}`);
console.log(`MVP browser shard ${index}/${total}: ${selected.length} spec files, ${all.length} total across all shards`);
for (const file of selectedPaths) console.log(`  - ${file}`);
const bin = process.platform === "win32" ? "node_modules/.bin/playwright.cmd" : "node_modules/.bin/playwright";
const child = spawnSync(join(process.cwd(), bin), ["test", ...selectedPaths], { stdio: "inherit", env: process.env });
if (child.error) throw child.error;
if (child.signal) throw new Error(`Playwright shard terminated by ${child.signal}`);
process.exitCode = child.status ?? 1;
