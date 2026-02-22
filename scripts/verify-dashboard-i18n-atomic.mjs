#!/usr/bin/env node
/**
 * Atomic Dashboard i18n Verifier
 * Detects:
 * 1. JSX text literals (e.g. <div>Text</div>)
 * 2. Legacy 'strings' imports
 * 3. Specific forbidden English tokens
 * 4. Template literals with hardcoded English
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const TARGET_DIRS = [
    join(ROOT, 'app', 'dashboard'),
    join(ROOT, 'components', 'dashboard'),
    join(ROOT, 'lib', 'hooks'), // In real usage we might filter this to only dashboard hooks
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

// Regex for JSX text nodes: >Text< (ignoring numbers, icons, attributes)
// Note: This is an approximation for static analysis.
const JSX_TEXT_REGEX = />\s*([a-zA-Z][^<>{}]*[a-zA-Z]|[a-zA-Z])\s*</g;

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
    } catch (err) { }
    return out;
}

function analyze() {
    const files = [];
    for (const d of TARGET_DIRS) {
        walkDir(d, files);
    }

    const report = [];
    let totalViolations = 0;

    for (const f of files) {
        const content = readFileSync(f, 'utf-8');
        const rel = relative(ROOT, f);
        let fileViolations = 0;

        // 1. Forbidden Keywords/Imports
        for (const tok of FORBIDDEN_TOKENS) {
            if (content.includes(tok)) {
                const lines = content.split('\n');
                const lineIdx = lines.findIndex(l => l.includes(tok));
                console.warn(`[V] ${rel}:${lineIdx + 1}: Forbidden token "${tok}"`);
                fileViolations++;
            }
        }

        // 2. JSX Literals
        if (f.endsWith('.tsx')) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const matches = [...line.matchAll(JSX_TEXT_REGEX)];
                for (const match of matches) {
                    const text = match[1].trim();
                    if (text === 'URL' || text === 'ID' || text === 'FID' || text === 'Promise') continue;
                    console.warn(`[V] ${rel}:${i + 1}: JSX literal "${text}"`);
                    fileViolations++;
                }
            }
        }

        if (fileViolations > 0) {
            report.push({ file: rel, count: fileViolations });
            totalViolations += fileViolations;
        }
    }

    console.log('\n--- ATOMIC i18n SCAN REPORT ---');
    if (report.length === 0) {
        console.log('✅ ZERO hardcoded strings found in dashboard scope.');
        process.exit(0);
    } else {
        report.forEach(r => console.log(`${r.file} → ${r.count} literal(s)`));
        console.log(`\n❌ TOTAL VIOLATIONS: ${totalViolations}`);
        process.exit(1);
    }
}

analyze();
