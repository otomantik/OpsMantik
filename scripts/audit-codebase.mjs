/**
 * Müfettiş Scripti (Kirli Kod Avcısı)
 * - Türkçe karakter (ğ, ş, ı, ö, ç) — yorum hariç
 * - Hardcoded secret (sk-proj-..., eyJ...)
 * - Spaghetti (400+ satır)
 * - console.log unutulmuş
 *
 * Usage: node scripts/audit-codebase.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SCAN_DIRS = ['app', 'components', 'lib', 'supabase/functions', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.sql'];

const report = {
  turkishChars: [],
  hardcodedSecrets: [],
  spaghettiFiles: [],
  consoleLogs: [],
};

function isCommentOnly(line, ext) {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('* ')) return true;
  if (ext === '.sql' && t.startsWith('--')) return true;
  return false;
}

function scanDir(directory) {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== '.git' && file !== 'dist') {
        scanDir(fullPath);
      }
    } else if (EXTENSIONS.includes(path.extname(file))) {
      analyzeFile(fullPath);
    }
  }
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(ROOT_DIR, filePath);
  const ext = path.extname(filePath);

  if (lines.length > 400) {
    report.spaghettiFiles.push(`${relativePath} (${lines.length} lines)`);
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (line.match(/sk-proj-[a-zA-Z0-9]{20,}/) || line.match(/eyJ[a-zA-Z0-9_-]{20,}/)) {
      if (!line.includes('process.env') && !line.includes('Deno.env') && !trimmed.startsWith('//')) {
        report.hardcodedSecrets.push(`${relativePath}:${index + 1}`);
      }
    }

    if (line.includes('console.log(') && !relativePath.includes('scripts/')) {
      report.consoleLogs.push(`${relativePath}:${index + 1}`);
    }

    if (ext !== '.sql' && line.match(/[ğüşıöçĞÜŞİÖÇ]/)) {
      if (!isCommentOnly(trimmed, ext)) {
        report.turkishChars.push(`${relativePath}:${index + 1} -> ${trimmed.substring(0, 60)}...`);
      }
    }
  });
}

console.log('🚀 OPERATION CLEAN SWEEP STARTED...\n');

SCAN_DIRS.forEach((dir) => {
  const target = path.join(ROOT_DIR, dir);
  if (fs.existsSync(target)) scanDir(target);
});

console.log('🍝 SPAGHETTI CODE (400+ lines):');
report.spaghettiFiles.forEach((f) => console.log(`  - ${f}`));
if (report.spaghettiFiles.length === 0) console.log('  (none)');

console.log('\n🔑 POTENTIAL HARDCODED SECRETS:');
report.hardcodedSecrets.forEach((f) => console.log(`  - ${f}`));
if (report.hardcodedSecrets.length === 0) console.log('  (none)');

console.log('\n📝 FORGOTTEN CONSOLE.LOGS (excluding scripts/):');
report.consoleLogs.slice(0, 15).forEach((f) => console.log(`  - ${f}`));
if (report.consoleLogs.length > 15) console.log(`  ... and ${report.consoleLogs.length - 15} more.`);
if (report.consoleLogs.length === 0) console.log('  (none)');

console.log('\n🇹🇷 TURKISH CHARACTERS (non-comment, exclude .sql):');
report.turkishChars.slice(0, 15).forEach((f) => console.log(`  - ${f}`));
if (report.turkishChars.length > 15) console.log(`  ... and ${report.turkishChars.length - 15} more.`);
if (report.turkishChars.length === 0) console.log('  (none)');

console.log('\n✅ Audit complete.');
