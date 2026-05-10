/**
 * PR-9H.7E — Koç hashed-phone canary closeout dossier + runbook policy (static contracts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');
const runbookPath = join(process.cwd(), 'docs', 'runbooks', 'OCI_HARDENING_OPERATIONS.md');

const SECTION_H7E = /## PR-9H\.7E — Koç Oto hashed-phone canary closeout \(terminal success\)/;

/** Slice from H7E header through EOF or next top-level `## ` (not `###`). */
function extractSection(md: string, headerRe: RegExp): string {
  const idx = md.search(headerRe);
  assert.ok(idx >= 0, 'section header not found');
  const after = md.slice(idx + 1);
  const rel = after.search(/\n## [^#]/);
  const end = rel === -1 ? md.length : idx + 1 + rel;
  return md.slice(idx, end);
}

test('PR-9H.7E: dossier records HASHED_PHONE_CANARY_TERMINAL_SUCCESS with row + ledger evidence', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const section = extractSection(md, SECTION_H7E);
  assert.match(section, /HASHED_PHONE_CANARY_TERMINAL_SUCCESS/);
  assert.match(section, /`COMPLETED`/);
  assert.match(section, /`uploaded_at`/);
  assert.match(section, /2026-05-10 22:19:48\.738/);
  assert.match(section, /`PROCESSING`/);
  assert.match(section, /`COMPLETED`/);
  assert.match(section, /OpsMantik_Won/);
  assert.match(section, /a81bec67-3b24-4c27-aa1a-40c7c4ecd0b2/);
  assert.match(section, /3276893e-0433-4e35-95f2-4e80cf863f4c/);
  assert.match(section, /93cb9966bcf349c1b4ece8ea34142ace/);
});

test('PR-9H.7E: dossier allows provider_request_id null for Script lane', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const section = extractSection(md, SECTION_H7E);
  assert.match(section, /provider_request_id.*null/i);
  assert.match(section, /Google Ads Script|bulk upload|Script lane/i);
});

test('PR-9H.7E: dossier preserves PR-9C invalid separate; forbids conflation', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const section = extractSection(md, SECTION_H7E);
  assert.match(section, /PR-9C/i);
  assert.match(section, /separate|invalid/i);
});

test('PR-9H.7E: dossier states no rerun and no recovery on target row', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const section = extractSection(md, SECTION_H7E);
  assert.match(section, /[Nn]o rerun|[Nn]o recovery|No rerun|No recovery/);
});

test('PR-9H.7E: dossier gates org-wide production-canary-success wording (PR-9H.4D dossier ban compatible)', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const section = extractSection(md, SECTION_H7E);
  assert.doesNotMatch(section, /PRODUCTION_CANARY_SUCCESS/);
  assert.match(section, /organization-wide.*production canary success|full evidence package/i);
});

test('PR-9H.7E: dossier documents EVIDENCE_PACKAGE_INCOMPLETE and PR-9H.7F backlog', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /EVIDENCE_PACKAGE_INCOMPLETE/);
  assert.match(md, /PR-9H\.7F/);
  assert.match(md, /export-run-summary|export_run_id|persist/i);
});

test('PR-9H.7E: runbook closeout rule — COMPLETED \+ uploaded_at, provider_request_id optional', () => {
  const md = readFileSync(runbookPath, 'utf8');
  assert.match(md, /PR-9H\.7E/);
  assert.match(md, /terminal success|COMPLETED.*uploaded_at|`uploaded_at IS NOT NULL`/i);
  assert.match(md, /provider_request_id.*null/i);
  assert.match(md, /Do not.*re-run|same allowlisted/i);
  assert.match(md, /PR-9C/i);
});
