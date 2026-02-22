#!/usr/bin/env node
/**
 * Verify that all t() and translate() calls use keys that exist in the dictionary.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

function loadEnKeys() {
    const enPath = path.join(ROOT, "lib", "i18n", "messages", "en.ts");
    const text = fs.readFileSync(enPath, "utf8");
    const keys = [];
    const re = /['"]([a-zA-Z0-9_.{}-]+)['"]\s*:/g;
    let m;
    while ((m = re.exec(text)) !== null) keys.push(m[1]);
    return new Set(keys);
}

const VALID_KEYS = loadEnKeys();

const SCAN_DIRS = [
    "app",
    "components",
    path.join("lib", "hooks"),
    path.join("lib", "services"),
    path.join("lib", "i18n"),
];
const EXCLUDE_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);
const MESSAGE_FILES_PREFIX = path.join("lib", "i18n", "messages");

function collectFiles(dirAbs, out = []) {
    if (!fs.existsSync(dirAbs)) return out;
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
        if (ent.isDirectory()) {
            if (EXCLUDE_DIRS.has(ent.name)) continue;
            collectFiles(path.join(dirAbs, ent.name), out);
        } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
            out.push(path.join(dirAbs, ent.name));
        }
    }
    return out;
}

function isInMessagesFile(fileName) {
    return path.relative(ROOT, fileName).replace(/\\/g, "/").startsWith(MESSAGE_FILES_PREFIX);
}

function scanFile(fileAbs) {
    if (isInMessagesFile(fileAbs)) return [];
    const text = fs.readFileSync(fileAbs, "utf8");
    const isTsx = fileAbs.endsWith(".tsx");
    const sourceFile = ts.createSourceFile(
        fileAbs,
        text,
        ts.ScriptTarget.Latest,
        true,
        isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const missing = [];

    function visit(node) {
        if (ts.isCallExpression(node)) {
            const expr = node.expression;
            const isT = ts.isIdentifier(expr) && expr.text === "t";
            const isTranslate = ts.isIdentifier(expr) && expr.text === "translate";
            if (isT || isTranslate) {
                const keyNode = isTranslate ? node.arguments[1] : node.arguments[0];
                if (keyNode && ts.isStringLiteral(keyNode)) {
                    const key = keyNode.text;
                    if (key && !VALID_KEYS.has(key)) {
                        const { line, character } = sourceFile.getLineAndCharacterOfPosition(keyNode.getStart());
                        missing.push({
                            file: path.relative(ROOT, fileAbs),
                            line: line + 1,
                            col: character + 1,
                            key,
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return missing;
}

const allFiles = SCAN_DIRS.flatMap((d) => collectFiles(path.join(ROOT, d)));
const allMissing = allFiles.flatMap(scanFile);

if (allMissing.length > 0) {
    console.error("--- i18n MISSING KEYS (not in dictionary) ---\n");
    for (const m of allMissing) {
        console.error(`${m.file}:${m.line}:${m.col}  key "${m.key}" not found in en dictionary`);
    }
    console.error(`\n❌ ${allMissing.length} missing key(s). Add them to lib/i18n/messages/en.ts (and tr, it).`);
    process.exit(1);
}

console.log("--- i18n KEYS VERIFY ---");
console.log("✅ All t()/translate() keys exist in dictionary.");
process.exit(0);
