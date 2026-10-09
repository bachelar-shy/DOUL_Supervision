/** Verify displayed resources against the independent workflow contracts.
 * transpileModule loads dictionary values only; the normal tsc check remains
 * responsible for semantic typing (TypeScript official compiler API guidance).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const ts = require("typescript");
const previousLoader = require.extensions[".ts"];
let resources;
try {
  require.extensions[".ts"] = (module, file) => {
    const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }));
    module._compile(result.outputText, file);
  };
  ({ resources } = require(path.join(root, "packages/localization/src/index.ts")));
} finally {
  if (previousLoader) require.extensions[".ts"] = previousLoader;
  else delete require.extensions[".ts"];
}

const { machines } = JSON.parse(fs.readFileSync(path.join(root, "app/schema/state_machines_v1.json"), "utf8"));
const commands = new Set(Object.values(machines).flatMap((machine) => machine.transitions.map((item) => item.command)));
const states = new Set(Object.values(machines).flatMap((machine) => machine.transitions.flatMap((item) => [item.from, item.to])));
const required = [...commands].map((name) => `command.${name}`).concat([...states].map((name) => `state.${name}`));
const errors = [];
for (const language of ["ko", "vi", "en"]) {
  const dictionary = resources[language].translation;
  for (const key of required) {
    const value = dictionary[key];
    if (typeof value !== "string" || !value.trim()) errors.push(`${language}: missing ${key}`);
    else if (language !== "ko" && /[가-힣]/u.test(value)) errors.push(`${language}: Korean fallback in ${key}`);
  }
}
console.log(JSON.stringify({
  ok: errors.length === 0, machines: Object.keys(machines).length,
  commands: commands.size, states: states.size, keysPerLanguage: required.length,
  languages: ["ko", "vi", "en"], nativeReview: "pending", errors,
}, null, 2));
process.exitCode = errors.length ? 1 : 0;
