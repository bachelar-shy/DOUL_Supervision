import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type Role = "SUP" | "CON" | "OWN" | "ADM" | "DES";
export type Domain = "role" | "feature" | "document" | "menu";
export type Outcome = "PASS" | "PARTIAL" | "BLOCKED" | "INVALID" | "FAIL";
export type Result = {
  id: string; domain: Domain; title: string; actor: Role; route: string;
  outcome: Outcome; workflowSteps: string[]; checked: string[];
  findings: string[]; elapsedMs: number; executionKind: string;
  evidenceIds: string[]; humanValidation: "PENDING";
};
export const outcomes: Outcome[] = ["PASS", "PARTIAL", "BLOCKED", "INVALID", "FAIL"];
const domains: Domain[] = ["role", "feature", "document", "menu"];

/** Playwright clears outputDir once per invocation, not when a failed worker restarts. */
export function persistCaseResult(outputDir: string, result: Result): string {
  if (!/^[A-Z0-9-]+$/.test(result.id)) throw new Error("Invalid UX200 case ID: " + result.id);
  const directory = resolve(outputDir, "ux200-cases");
  mkdirSync(directory, { recursive: true });
  const target = resolve(directory, result.id + ".json");
  const temporary = target + "." + process.pid + ".tmp";
  writeFileSync(temporary, JSON.stringify(result, null, 2) + "\n");
  renameSync(temporary, target);
  return target;
}

/** Count case IDs once. The final worker reads evidence from every earlier worker. */
export function aggregateCaseResults(outputDir: string, catalogue: Result[]) {
  let attempted = 0;
  const results = catalogue.map(fallback => {
    const file = resolve(outputDir, "ux200-cases", fallback.id + ".json");
    if (!existsSync(file)) return {
      ...fallback, outcome: "BLOCKED" as const,
      findings: ["테스트가 실제 실행되지 않음"], elapsedMs: 0,
    };
    try {
      const result = JSON.parse(readFileSync(file, "utf8")) as Result;
      const textArrays = [result.workflowSteps, result.checked, result.findings, result.evidenceIds];
      if (result.id !== fallback.id || result.domain !== fallback.domain || !outcomes.includes(result.outcome) ||
          !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0 ||
          !textArrays.every(value => Array.isArray(value) && value.every(item => typeof item === "string")))
        throw new Error("Invalid UX200 case evidence: " + file);
      attempted++;
      return result;
    } catch (error) {
      // Corrupt evidence is a failed audit, not proof that a case passed or ran.
      // Keep generating the full reports before the acceptance gate rejects it.
      return { ...fallback, outcome: "FAIL" as const, elapsedMs: 0,
        findings: ["개별 시험 증빙을 읽거나 검증할 수 없음: " + String(error)] };
    }
  });
  const counts = Object.fromEntries(outcomes.map(status =>
    [status, results.filter(result => result.outcome === status).length])) as Record<Outcome, number>;
  const byDomain = Object.fromEntries(domains.map(domain => [domain,
    Object.fromEntries(outcomes.map(status =>
      [status, results.filter(result => result.domain === domain && result.outcome === status).length]))]));
  return { attempted, counts, byDomain, results };
}

export function assertAcceptanceGate(attempted: number, requested: number, counts: Record<Outcome, number>): void {
  if (attempted !== requested || counts.FAIL > 0 || counts.INVALID > 0) {
    throw new Error("UX200 acceptance blocked: " + JSON.stringify({
      attempted, requested, failed: counts.FAIL, invalid: counts.INVALID,
      incomplete: counts.PARTIAL + counts.BLOCKED,
    }) + "; see preserved JSON/CSV report");
  }
}
