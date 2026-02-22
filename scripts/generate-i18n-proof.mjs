#!/usr/bin/env node
/**
 * Generate I18N proof doc: scanner report + dictionary audit.
 * Usage: node scripts/generate-i18n-proof.mjs [output-path]
 * Default: docs/_evidence/I18N_DASHBOARD_PROOF_PHASE_3_3.md
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const defaultPath = path.join(ROOT, "docs/_evidence/I18N_DASHBOARD_PROOF_PHASE_3_3.md");
const outputPath = process.argv[2] || defaultPath;

// Ensure output dir exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let content = "";

// 1. Scanner report
const r1 = spawnSync("node", ["scripts/verify-i18n-no-hardcoded.mjs", "--mode=report"], {
  cwd: ROOT,
  encoding: "utf8",
});
content += (r1.stdout || "").trim();
if (r1.stderr) content += "\n" + r1.stderr;
if (r1.status !== 0) {
  console.error("Scanner failed (exit " + r1.status + ")");
  process.exit(r1.status);
}

// 2. Dictionary audit
content += "\n\n--- DICTIONARY AUDIT ---\n\n";
const r2 = spawnSync("node", ["--import", "tsx", "scripts/audit-i18n-dictionaries.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
});
content += (r2.stdout || "").trim();
if (r2.stderr) content += "\n" + r2.stderr;
if (r2.status !== 0) {
  console.error("Audit failed (exit " + r2.status + ")");
  process.exit(r2.status);
}

fs.writeFileSync(outputPath, content, "utf8");
console.log("Written:", outputPath);
