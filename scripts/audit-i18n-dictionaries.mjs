#!/usr/bin/env node
/**
 * i18n Dictionary Audit Tool
 * Compares en.ts, tr.ts, and it.ts for key symmetry and completeness.
 */

import fs from "node:fs";
import path from "node:path";
import { en } from "../lib/i18n/messages/en.ts";
import { tr } from "../lib/i18n/messages/tr.ts";
import { it } from "../lib/i18n/messages/it.ts";

const locales = { en, tr, it };
const baseLocale = "en";
const baseKeys = Object.keys(locales[baseLocale]);

let exitCode = 0;

console.log(`--- i18n DICTIONARY AUDIT ---`);
console.log(`Base Locale: ${baseLocale} (${baseKeys.length} keys)\n`);

for (const [lang, messages] of Object.entries(locales)) {
    if (lang === baseLocale) continue;

    const keys = Object.keys(messages);
    const missing = baseKeys.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !baseKeys.includes(k));
    const empty = Object.entries(messages)
        .filter(([k, v]) => baseKeys.includes(k) && (v === "" || v === null || v === undefined))
        .map(([k]) => k);

    console.log(`Locale: ${lang}`);
    console.log(`- Total Keys: ${keys.length}`);

    if (missing.length > 0) {
        console.error(`- ❌ MISSING KEYS (${missing.length}):`);
        missing.forEach(k => console.error(`    ${k}`));
        exitCode = 1;
    } else {
        console.log(`- ✅ No missing keys.`);
    }

    if (extra.length > 0) {
        console.warn(`- ⚠️ EXTRA KEYS (${extra.length}):`);
        extra.forEach(k => console.warn(`    ${k}`));
        // extra keys don't fail the audit but are warned
    }

    if (empty.length > 0) {
        console.error(`- ❌ EMPTY VALUES (${empty.length}):`);
        empty.forEach(k => console.error(`    ${k}`));
        exitCode = 1;
    }

    console.log("");
}

if (exitCode === 0) {
    console.log(`✅ Dictionary Audit Passed! All locales are in sync.`);
} else {
    console.error(`❌ Dictionary Audit Failed! Please sync the keys.`);
}

process.exit(exitCode);
