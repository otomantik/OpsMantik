#!/usr/bin/env node
/**
 * Atomic Dashboard i18n Verifier
 * Detects:
 * 1. JSX text literals (e.g. <motion.div>Text</div>)
 * 2. Legacy 'strings' imports
 * 3. Specific forbidden English tokens
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const TARGET_DIRS = [
    join(ROOT, 'app', 'dashboard'),
    join(ROOT, 'components', 'dashboard'),
    join(ROOT, 'lib', 'hooks'),
];

const FORBIDDEN_TOKENS = [
    'import { strings }',
    "from '@/lib/i18n/en'",
    'lib/i18n/en',
    'WAR ROOM',
    'Traffic Sources',
    'Revenue Projection',
    'Conversion Pulse',
    'OCI ACTIVE',
    'CAPTURE',
    'SHIELD',
    'EFFICIENCY',
    'INTEREST',
    'Activity Log',
    'Undone',
    'Deal cancelled',
];

const JSX_TEXT_REGEX = />\s*([a-zA-Z][^<>{}]*[a-zA-Z]|[a-zA-Z])\s*</g;

const mode = process.argv.includes('--mode=baseline') ? 'baseline' : 'fail';
const baselinePathArg = process.argv.find((a) => a.startsWith('--baseline='));
const baselinePath = baselinePathArg ? baselinePathArg.split('=')[1] : 'dashboard-i18n-baseline.json';

function normFile(file) {
    return String(file).replace(/\\/g, '/');
}

function violationKey(v) {
    return `${normFile(v.file)}:${v.line}:${v.rule}:${v.text}`;
}

function loadBaseline(path) {
    if (!path || !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

function walkDir(dir, out = []) {
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = join(dir, e.name);
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
                walkDir(full, out);
            } else if (e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.ts'))) {
                out.push(full);
            }
        }
    } catch {
        /* missing target dir */
    }
    return out;
}

function collectViolations() {
    const files = [];
    for (const d of TARGET_DIRS) {
        walkDir(d, files);
    }

    const violations = [];

    for (const f of files) {
        const content = readFileSync(f, 'utf8');
        const rel = normFile(relative(ROOT, f));

        for (const tok of FORBIDDEN_TOKENS) {
            if (!content.includes(tok)) continue;
            const lineIdx = content.split('\n').findIndex((l) => l.includes(tok));
            violations.push({
                file: rel,
                line: lineIdx + 1,
                rule: 'forbidden-token',
                text: tok,
            });
        }

        if (!f.endsWith('.tsx')) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const match of line.matchAll(JSX_TEXT_REGEX)) {
                const text = match[1].trim();
                if (text === 'URL' || text === 'ID' || text === 'FID' || text === 'Promise') continue;
                violations.push({
                    file: rel,
                    line: i + 1,
                    rule: 'jsx-text',
                    text,
                });
            }
        }
    }

    return violations;
}

function analyze() {
    const violations = collectViolations();
    const baseline = mode === 'baseline' ? loadBaseline(baselinePath) : null;
    const baselineSet = baseline ? new Set(baseline.map(violationKey)) : null;

    const newOnes = baselineSet
        ? violations.filter((v) => !baselineSet.has(violationKey(v)))
        : violations;

    for (const v of violations) {
        if (baselineSet && baselineSet.has(violationKey(v))) continue;
        if (v.rule === 'forbidden-token') {
            console.warn(`[V] ${v.file}:${v.line}: Forbidden token "${v.text}"`);
        } else {
            console.warn(`[V] ${v.file}:${v.line}: JSX literal "${v.text}"`);
        }
    }

    console.log('\n--- ATOMIC i18n SCAN REPORT ---');
    if (newOnes.length === 0) {
        if (mode === 'baseline' && violations.length > 0) {
            console.log(`No new dashboard i18n violations vs baseline. Current total: ${violations.length}`);
        } else {
            console.log('✅ ZERO hardcoded strings found in dashboard scope.');
        }
        process.exit(0);
    }

    const byFile = new Map();
    for (const v of newOnes) {
        byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
    }
    for (const [file, count] of byFile) {
        console.log(`${file} → ${count} literal(s)`);
    }
    console.log(`\n❌ NEW VIOLATIONS: ${newOnes.length}`);
    process.exit(1);
}

analyze();
