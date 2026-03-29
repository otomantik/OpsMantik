/**
 * Intent-first dashboard structure: legacy CRM / follow-up desk UI removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shellPath = join(process.cwd(), 'components', 'dashboard', 'dashboard-shell.tsx');
const queuePath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue.tsx');
const queueHeaderPath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'queue-header.tsx');
const queueStatesPath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'queue-states.tsx');
const activityInlinePath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'activity-log-inline.tsx');
const ociControlPath = join(process.cwd(), 'components', 'dashboard', 'oci-control', 'oci-control-panel.tsx');
const deskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'conversations', 'page.tsx');
const todayDeskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'today-desk', 'page.tsx');
const assigneesRoutePath = join(process.cwd(), 'app', 'api', 'sites', '[siteId]', 'assignees', 'route.ts');

test('dashboard shell is intent-first: no CRM desk or follow-up preview', () => {
  const src = readFileSync(shellPath, 'utf8');
  assert.ok(!src.includes('FollowUpPreview'), 'dashboard shell does not import CRM follow-up preview');
  assert.ok(!src.includes('/conversations'), 'dashboard shell does not link to legacy conversation desk');
  assert.ok(!src.includes('today-desk'), 'dashboard shell does not link to today desk');
  assert.ok(src.includes("dashboard.intents"), 'dashboard shell exposes localized intent navigation');
  assert.ok(src.includes("dashboard.reportsHub"), 'dashboard shell exposes localized reports navigation');
  assert.ok(src.includes('id="niyetler"'), 'dashboard shell anchors the intents section');
  assert.ok(src.includes('id="raporlar"'), 'dashboard shell anchors the reports section');
});

test('legacy CRM routes redirect to intent command center', () => {
  const conv = readFileSync(deskPagePath, 'utf8');
  const today = readFileSync(todayDeskPagePath, 'utf8');
  assert.ok(conv.includes('redirect(`'), 'conversations route redirects');
  assert.ok(conv.includes('/dashboard/site/${siteId}'), 'conversations redirect targets site dashboard');
  assert.ok(!conv.includes('ConversationDeskShell'), 'conversations page does not mount CRM shell');
  assert.ok(today.includes('redirect(`'), 'today-desk route redirects');
  assert.ok(today.includes('/dashboard/site/${siteId}'), 'today-desk redirect targets site dashboard');
  assert.ok(!today.includes('ConversationDeskShell'), 'today-desk page does not mount CRM shell');
});

test('qualification queue shell keeps premium header and state copy localized', () => {
  const queueSrc = readFileSync(queuePath, 'utf8');
  const headerSrc = readFileSync(queueHeaderPath, 'utf8');
  const statesSrc = readFileSync(queueStatesPath, 'utf8');
  const activitySrc = readFileSync(activityInlinePath, 'utf8');
  assert.ok(queueSrc.includes('day={range.day}'), 'queue forwards active day into header chrome');
  assert.ok(headerSrc.includes("dashboard.queue.title"), 'queue header uses localized product title');
  assert.ok(headerSrc.includes("dashboard.queue.subtitle"), 'queue header uses localized product subtitle');
  assert.ok(statesSrc.includes("queue.loadingTitle"), 'queue loading state uses localized copy');
  assert.ok(statesSrc.includes("queue.errorTitle"), 'queue error state uses localized copy');
  assert.ok(statesSrc.includes("queue.emptyTodayTitle"), 'queue empty state uses localized today copy');
  assert.ok(activitySrc.includes("activity.subtitle"), 'activity stream includes localized explanatory subtitle');
});

test('oci control panel turns summary boxes into useful filters', () => {
  const src = readFileSync(ociControlPath, 'utf8');
  assert.ok(src.includes('setStatusFilter((current) => current === status ? \'\' : status)'), 'oci summary cards toggle status filtering');
  assert.ok(src.includes("ociControl.status."), 'oci panel localizes operator-facing queue statuses');
  assert.ok(src.includes("ociControl.loadMore"), 'oci panel keeps localized pagination action');
});

test('assignees route validates access and uses admin-backed member lookup', () => {
  const src = readFileSync(assigneesRoutePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'assignees route validates site access');
  assert.ok(src.includes("from('site_members')"), 'assignees route reads site members');
  assert.ok(src.includes("from('user_emails')"), 'assignees route resolves user emails');
  assert.ok(src.includes("source: 'owner'"), 'assignees route includes owner row');
});
