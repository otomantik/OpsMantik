#!/usr/bin/env node
/**
 * REPO-WIDE AST i18n Verifier (OpsMantik Master Plan)
 * Detects:
 * 1. JSX text nodes (non-whitespace)
 * 2. Hardcoded visible props (placeholder, title, etc.)
 * 3. Toast literals
 * 4. Legacy i18n system imports
 *
 * Supports: --mode=report, --mode=baseline, --mode=fail
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

const SCAN_DIRS = [
    "app",
    "components",
    path.join("lib", "hooks"),
    path.join("lib", "services"),
];

const EXCLUDE_DIRS = new Set([
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
]);

const MESSAGE_FILES_PREFIX = path.join("lib", "i18n", "messages");

const VISIBLE_PROPS = new Set([
    "title",
    "label",
    "placeholder",
    "description",
    "helperText",
    "subtitle",
    "emptyText",
    "noDataText",
    "ctaText",
    "aria-label",
]);

const ALLOW_PROP_NAMES = new Set([
    "className",
    "aria-hidden",
    "data-testid",
]);

function isUrlLike(s) {
    return /^https?:\/\/|^mailto:|^tel:/.test(s);
}
function isRouteLike(s) {
    return s.startsWith("/") && !s.includes(" ");
}
function isDataAttr(name) {
    return name.startsWith("data-");
}

function collectFiles(dirAbs, out = []) {
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
        if (ent.isDirectory()) {
            if (EXCLUDE_DIRS.has(ent.name)) continue;
            collectFiles(path.join(dirAbs, ent.name), out);
            continue;
        }
        if (!ent.isFile()) continue;
        if (!/\.(ts|tsx)$/.test(ent.name)) continue;
        out.push(path.join(dirAbs, ent.name));
    }
    return out;
}

function getIgnoreReasonAtPosition(sourceFile, pos) {
    const ranges = ts.getLeadingCommentRanges(sourceFile.getFullText(), pos) || [];
    for (const r of ranges) {
        const text = sourceFile.getFullText().slice(r.pos, r.end);
        const m = text.match(/i18n-ignore:\s*(.+)/);
        if (m && m[1] && m[1].trim().length > 0) return m[1].trim();
        if (text.includes("i18n-ignore") && !m) return "__MISSING_REASON__";
    }
    return null;
}

function reportNode(sourceFile, node, rule, message) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    return {
        file: path.relative(ROOT, sourceFile.fileName),
        line: line + 1,
        col: character + 1,
        rule,
        message,
    };
}

function isInMessagesFile(fileName) {
    const rel = path.relative(ROOT, fileName);
    return rel.startsWith(MESSAGE_FILES_PREFIX);
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

    const violations = [];

    function visit(node) {
        const ignore = getIgnoreReasonAtPosition(sourceFile, node.getFullStart());
        if (ignore === "__MISSING_REASON__") {
            violations.push(reportNode(sourceFile, node, "ignore-missing-reason", "i18n-ignore must include a reason"));
        } else if (ignore) {
            return;
        }

        if (ts.isJsxText(node)) {
            const v = node.getText(sourceFile);
            if (v && v.trim().length > 0 && /[a-zA-Z]/.test(v)) {
                violations.push(reportNode(sourceFile, node, "jsx-text", `Hardcoded JSX text: "${v.trim().slice(0, 80)}"`));
            }
        }

        if (ts.isJsxAttribute(node)) {
            const propName = node.name.getText(sourceFile);
            if (ALLOW_PROP_NAMES.has(propName) || isDataAttr(propName)) {
                // allowed
            } else if (VISIBLE_PROPS.has(propName)) {
                const init = node.initializer;
                if (init && ts.isStringLiteral(init)) {
                    const s = init.text;
                    if (s.length > 0 && /[a-zA-Z]/.test(s) && !isUrlLike(s) && !isRouteLike(s)) {
                        violations.push(reportNode(sourceFile, node, "visible-prop", `Hardcoded prop "${propName}": "${s.slice(0, 80)}"`));
                    }
                }
                if (init && ts.isJsxExpression(init) && init.expression) {
                    const expr = init.expression;
                    if (ts.isStringLiteral(expr)) {
                        const s = expr.text;
                        if (s.length > 0 && /[a-zA-Z]/.test(s) && !isUrlLike(s) && !isRouteLike(s)) {
                            violations.push(reportNode(sourceFile, node, "visible-prop", `Hardcoded prop "${propName}": "${s.slice(0, 80)}"`));
                        }
                    } else if (ts.isNoSubstitutionTemplateLiteral(expr)) {
                        const s = expr.text;
                        if (s.length > 0 && /[a-zA-Z]/.test(s)) {
                            violations.push(reportNode(sourceFile, node, "visible-prop-template", `Hardcoded template in prop "${propName}": "${s.slice(0, 80)}"`));
                        }
                    } else if (ts.isTemplateExpression(expr)) {
                        // Check head and spans for hardcoded text
                        const checkText = (t) => t.length > 0 && /[a-zA-Z]/.test(t) && !isUrlLike(t);
                        if (checkText(expr.head.text)) {
                            violations.push(reportNode(sourceFile, node, "visible-prop-template", `Hardcoded template head in "${propName}": "${expr.head.text.slice(0, 80)}"`));
                        }
                        for (const span of expr.templateSpans) {
                            if (checkText(span.literal.text)) {
                                violations.push(reportNode(sourceFile, node, "visible-prop-template", `Hardcoded template span in "${propName}": "${span.literal.text.slice(0, 80)}"`));
                            }
                        }
                    }
                }
            }
        }

        if (ts.isCallExpression(node)) {
            const expr = node.expression;
            const isToast = ts.isIdentifier(expr) && expr.text === "toast";
            const isToastDot = ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "toast";

            if (isToast || isToastDot) {
                for (const arg of node.arguments) {
                    if (ts.isStringLiteral(arg)) {
                        const s = arg.text;
                        if (s.length > 0 && /[a-zA-Z]/.test(s)) {
                            violations.push(reportNode(sourceFile, arg, "toast-literal", `Hardcoded toast string: "${s.slice(0, 80)}"`));
                        }
                    } else if (ts.isNoSubstitutionTemplateLiteral(arg)) {
                        const s = arg.text;
                        if (s.length > 0 && /[a-zA-Z]/.test(s)) {
                            violations.push(reportNode(sourceFile, arg, "toast-template-literal", `Hardcoded toast template: "${s.slice(0, 80)}"`));
                        }
                    } else if (ts.isTemplateExpression(arg)) {
                        const checkText = (t) => t.length > 0 && /[a-zA-Z]/.test(t);
                        if (checkText(arg.head.text)) {
                            violations.push(reportNode(sourceFile, arg, "toast-template-literal", `Hardcoded toast template head: "${arg.head.text.slice(0, 80)}"`));
                        }
                        for (const span of arg.templateSpans) {
                            if (checkText(span.literal.text)) {
                                violations.push(reportNode(sourceFile, arg, "toast-template-literal", `Hardcoded toast template span: "${span.literal.text.slice(0, 80)}"`));
                            }
                        }
                    }
                }
            }

            // STATIC KEY ENFORCEMENT for t() and translate()
            const isT = ts.isIdentifier(expr) && expr.text === "t";
            const isTranslate = ts.isIdentifier(expr) && expr.text === "translate";
            if (isT || isTranslate) {
                const firstArg = node.arguments[0];
                if (firstArg) {
                    // Check if first arg is t(key) or translate(locale, key)
                    const keyNode = isTranslate ? node.arguments[1] : firstArg;
                    if (keyNode && !ts.isStringLiteral(keyNode)) {
                        violations.push(reportNode(sourceFile, keyNode, "dynamic-key", `Forbidden dynamic key in ${expr.text}(): keys must be string literals.`));
                    }
                }
            }
        }

        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const mod = node.moduleSpecifier.text;
            if (mod.includes("lib/i18n/en") || mod.endsWith("/lib/i18n/en.ts")) {
                violations.push(reportNode(sourceFile, node, "legacy-import", `Legacy i18n import: "${mod}"`));
            }
        }

        if (ts.isVariableDeclaration(node)) {
            const typeName = node.type ? node.type.getText(sourceFile) : "";
            if (typeName.includes("Metadata")) {
                const init = node.initializer;
                if (init && ts.isObjectLiteralExpression(init)) {
                    for (const prop of init.properties) {
                        if (ts.isPropertyAssignment(prop)) {
                            const name = prop.name.getText(sourceFile);
                            if (name === "title" || name === "description") {
                                const val = prop.initializer;
                                if (ts.isStringLiteral(val)) {
                                    const s = val.text;
                                    if (s.length > 0 && /[a-zA-Z]/.test(s)) {
                                        violations.push(reportNode(sourceFile, val, "metadata-literal", `Hardcoded metadata ${name}: "${s.slice(0, 80)}"`));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return violations;
}

function scanRepo() {
    const files = [];
    for (const relDir of SCAN_DIRS) {
        const abs = path.join(ROOT, relDir);
        if (!fs.existsSync(abs)) continue;
        collectFiles(abs, files);
    }
    return files.flatMap(scanFile);
}

function formatViolations(violations) {
    return violations
        .sort((a, b) => (a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col))
        .map(v => `${v.file}:${v.line}:${v.col}  ${v.rule}\n  ${v.message}`)
        .join("\n\n");
}

function loadBaseline(baselinePath) {
    if (!baselinePath || !fs.existsSync(baselinePath)) return null;
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

function baselineKey(v) {
    return `${v.file}:${v.line}:${v.col}:${v.rule}`;
}

const mode = process.argv.includes("--mode=report") ? "report" : process.argv.includes("--mode=baseline") ? "baseline" : "fail";
const baselinePathArg = process.argv.find(a => a.startsWith("--baseline="));
const baselinePath = baselinePathArg ? baselinePathArg.split("=")[1] : "i18n-baseline.json";

const violations = scanRepo();

if (mode === "report") {
    console.log(formatViolations(violations));
    console.log(`\nTotal i18n violations: ${violations.length}`);
    // If emit-baseline is provided, write it
    const emitBaselineArg = process.argv.find(a => a.startsWith("--emit-baseline="));
    if (emitBaselineArg) {
        const p = emitBaselineArg.split("=")[1];
        fs.writeFileSync(p, JSON.stringify(violations, null, 2));
        console.log(`Baseline written to ${p}`);
    }
    process.exit(0);
}

if (mode === "baseline") {
    const baseline = loadBaseline(baselinePath);
    if (!baseline) {
        console.error(`Baseline not found at ${baselinePath}. Generate it first.`);
        process.exit(2);
    }
    const baselineSet = new Set(baseline.map(baselineKey));
    const newOnes = violations.filter(v => !baselineSet.has(baselineKey(v)));
    if (newOnes.length > 0) {
        console.error(formatViolations(newOnes));
        console.error(`\nNew i18n violations vs baseline: ${newOnes.length}`);
        process.exit(1);
    }
    console.log(`No new i18n violations vs baseline. Current total: ${violations.length}`);
    process.exit(0);
}

if (violations.length > 0) {
    console.error(formatViolations(violations));
    console.error(`\nTotal i18n violations: ${violations.length}`);
    process.exit(1);
}
console.log("i18n guard passed: 0 violations");
process.exit(0);
