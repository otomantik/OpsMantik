#!/usr/bin/env node
/**
 * Find i18n keys defined in en.ts that are never used in t() or translate().
 * Usage: node scripts/find-unused-i18n-keys.mjs
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const EN_PATH = path.join(ROOT, "lib", "i18n", "messages", "en.ts");
const MESSAGE_FILES = path.join(ROOT, "lib", "i18n", "messages");

function loadEnKeys() {
  const text = fs.readFileSync(EN_PATH, "utf8");
  const keys = [];
  const re = /['"]([a-zA-Z0-9_.{}-]+)['"]\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) keys.push(m[1]);
  return keys;
}

function collectTsTsxFiles(dirAbs, out = []) {
  if (!fs.existsSync(dirAbs)) return out;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", ".next", "dist", "build", "coverage"].includes(ent.name)) continue;
      collectTsTsxFiles(full, out);
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      if (path.relative(ROOT, full).replace(/\\/g, "/").startsWith("lib/i18n/messages/")) continue;
      out.push(full);
    }
  }
  return out;
}

function extractUsedKeys(fileAbs) {
  const text = fs.readFileSync(fileAbs, "utf8");
  const isTsx = fileAbs.endsWith(".tsx");
  const sourceFile = ts.createSourceFile(
    fileAbs,
    text,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const used = new Set();
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const isT = ts.isIdentifier(expr) && expr.text === "t";
      const isTranslate = ts.isIdentifier(expr) && expr.text === "translate";
      if (isT || isTranslate) {
        const keyNode = node.arguments[0];
        if (keyNode && ts.isStringLiteral(keyNode) && keyNode.text) {
          used.add(keyNode.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return used;
}

const allEnKeys = loadEnKeys();
const dirs = [path.join(ROOT, "app"), path.join(ROOT, "components"), path.join(ROOT, "lib")];
const files = dirs.flatMap((d) => collectTsTsxFiles(d));
const usedKeys = new Set();
for (const f of files) {
  for (const k of extractUsedKeys(f)) usedKeys.add(k);
}

const unused = allEnKeys.filter((k) => !usedKeys.has(k)).sort();
console.log("Unused i18n keys (in en.ts but never t()/translate() in app, components, lib):");
console.log("Total:", unused.length, "of", allEnKeys.length);
if (unused.length > 0) {
  unused.forEach((k) => console.log(" ", k));
}
