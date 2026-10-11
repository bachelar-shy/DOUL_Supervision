import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { aggregateCaseResults, assertAcceptanceGate, persistCaseResult, type Result } from "./ux200-evidence";

function probe(id: string, outcome: Result["outcome"]): Result {
  return {
    id, outcome, domain: "menu", title: "worker restart evidence probe", actor: "SUP", route: "today",
    workflowSteps: [], checked: [], findings: [], elapsedMs: 0,
    executionKind: "harness_regression", evidenceIds: [], humanValidation: "PENDING",
  };
}
function scratch() {
  mkdirSync("work", { recursive: true });
  return mkdtempSync(resolve("work/pr178-ux200-evidence-"));
}

test("a failed case keeps its status and evidence after Playwright restarts the worker", async () => {
  test.setTimeout(30000);
  const directory = scratch();
  try {
    const catalogue = [probe("MC-PROBE-01", "FAIL"), probe("MC-PROBE-02", "PASS")];
    const helper = resolve("tests_browser/ux200-evidence.ts");
    writeFileSync(resolve(directory, "playwright.config.cjs"), "module.exports = " + JSON.stringify({
      testDir: directory, workers: 1, fullyParallel: false, maxFailures: 0, retries: 0,
      outputDir: resolve(directory, "results"),
      reporter: [["json", { outputFile: resolve(directory, "playwright.json") }]],
    }));
    writeFileSync(resolve(directory, "worker-restart.spec.ts"), `
      import { test, expect } from "@playwright/test";
      import { persistCaseResult, aggregateCaseResults, assertAcceptanceGate } from ${JSON.stringify(helper)};
      import { writeFileSync } from "node:fs";
      const catalogue = ${JSON.stringify(catalogue)};
      test("failed case", async ({}, info) => {
        persistCaseResult(info.project.outputDir, catalogue[0]);
        writeFileSync(${JSON.stringify(resolve(directory, "first-worker.json"))}, JSON.stringify({ worker: info.workerIndex }));
        expect(false, "intentional failed case, not a product failure").toBe(true);
      });
      test("next case", async ({}, info) => {
        persistCaseResult(info.project.outputDir, catalogue[1]);
        writeFileSync(${JSON.stringify(resolve(directory, "next-worker.json"))}, JSON.stringify({ worker: info.workerIndex }));
      });
      test("independent summary gate", async ({}, info) => {
        const result = aggregateCaseResults(info.project.outputDir, catalogue);
        writeFileSync(${JSON.stringify(resolve(directory, "summary.json"))}, JSON.stringify(result));
        assertAcceptanceGate(result.attempted, 2, result.counts);
      });
    `);
    const child = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"),
      "test", "--config", resolve(directory, "playwright.config.cjs")], {
      cwd: process.cwd(), encoding: "utf8", timeout: 20000,
    });
    expect(child.error, child.stderr).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(1);
    const report = JSON.parse(readFileSync(resolve(directory, "playwright.json"), "utf8"));
    const cases = report.suites.flatMap((suite: any) => suite.specs);
    expect(cases.map((entry: any) => [entry.title, entry.tests[0].results[0].status])).toEqual([
      ["failed case", "failed"], ["next case", "passed"], ["independent summary gate", "failed"],
    ]);
    const first = JSON.parse(readFileSync(resolve(directory, "first-worker.json"), "utf8"));
    const next = JSON.parse(readFileSync(resolve(directory, "next-worker.json"), "utf8"));
    expect(next.worker).toBeGreaterThan(first.worker);
    const summary = JSON.parse(readFileSync(resolve(directory, "summary.json"), "utf8"));
    expect(summary.attempted).toBe(2);
    expect(summary.counts.FAIL).toBe(1);
    expect(summary.counts.PASS).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing and INVALID cases block acceptance and repeated evidence counts a case only once", () => {
  const directory = scratch();
  try {
    const catalogue = [probe("MC-PROBE-01", "PASS"), probe("MC-PROBE-02", "INVALID")];
    persistCaseResult(directory, catalogue[0]);
    persistCaseResult(directory, catalogue[0]);
    const incomplete = aggregateCaseResults(directory, catalogue);
    expect(incomplete.attempted).toBe(1);
    expect(incomplete.counts.BLOCKED).toBe(1);
    expect(() => assertAcceptanceGate(incomplete.attempted, 2, incomplete.counts)).toThrow("acceptance blocked");
    persistCaseResult(directory, catalogue[1]);
    const invalid = aggregateCaseResults(directory, catalogue);
    expect(invalid.attempted).toBe(2);
    expect(invalid.counts.INVALID).toBe(1);
    expect(() => assertAcceptanceGate(invalid.attempted, 2, invalid.counts)).toThrow('"invalid":1');
    writeFileSync(resolve(directory, "ux200-cases/MC-PROBE-02.json"), "{corrupt JSON");
    const corrupt = aggregateCaseResults(directory, catalogue);
    expect(corrupt.results).toHaveLength(2);
    expect(corrupt.attempted).toBe(1);
    expect(corrupt.counts.FAIL).toBe(1);
    expect(corrupt.results[1].findings[0]).toContain("증빙을 읽거나 검증할 수 없음");
    expect(() => assertAcceptanceGate(corrupt.attempted, 2, corrupt.counts)).toThrow('"failed":1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
