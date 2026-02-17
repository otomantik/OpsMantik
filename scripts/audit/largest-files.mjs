#!/usr/bin/env node
/**
 * List largest source files (bytes) for CODE_QUALITY_AUDIT.
 * Usage: node scripts/audit/largest-files.mjs [limit]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd());
const limit = parseInt(process.argv[2] || '25', 10);
const ignore = /(?:node_modules|\.next|coverage|\.git)\\/;
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (ignore.test(rel)) continue;
    if (e.isDirectory()) walk(full, out);
    else if (exts.has(path.extname(e.name))) out.push({ rel, size: fs.statSync(full).size });
  }
}

const files = [];
walk(root, files);
files.sort((a, b) => b.size - a.size);
const top = files.slice(0, limit);
const maxRel = Math.max(...top.map((f) => f.rel.length));
for (const f of top) {
  console.log(`${String(f.size).padStart(10)}  ${f.rel}`);
}
