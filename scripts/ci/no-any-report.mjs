#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const includeExt = new Set(['.ts', '.tsx']);
const ignoreDirs = new Set([
  '.git',
  '.next',
  'node_modules',
  'coverage',
  'public',
  'scripts',
  'artifacts',
  'tmp',
  'test-results',
]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    const path = join(dir, entry.name);
    if ([...includeExt].some((ext) => path.endsWith(ext))) {
      out.push(path);
    }
  }
}

function countExplicitAny(source) {
  const regexes = [
    /:\s*any\b/g,
    /<\s*any\s*>/g,
    /\bas\s+any\b/g,
  ];
  let count = 0;
  for (const regex of regexes) {
    const matches = source.match(regex);
    count += matches ? matches.length : 0;
  }
  return count;
}

function parseArgs(argv) {
  return {
    strict: argv.includes('--strict'),
    max: Number(process.env.NO_ANY_MAX ?? (argv.includes('--strict') ? 0 : Number.MAX_SAFE_INTEGER)),
  };
}

const args = parseArgs(process.argv.slice(2));
const files = [];
walk(root, files);

const rows = [];
for (const file of files) {
  const stat = statSync(file);
  if (!stat.isFile()) continue;
  const source = readFileSync(file, 'utf8');
  const count = countExplicitAny(source);
  if (count > 0) {
    rows.push({ file: relative(root, file), count });
  }
}

rows.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
const total = rows.reduce((sum, row) => sum + row.count, 0);

const report = {
  totalExplicitAny: total,
  filesWithAny: rows.length,
  topFiles: rows.slice(0, 100),
};

console.log(JSON.stringify(report, null, 2));

if (args.strict && total > args.max) {
  console.error(`no-any strict failed: totalExplicitAny=${total} max=${args.max}`);
  process.exit(1);
}
