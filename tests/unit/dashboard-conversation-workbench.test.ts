import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shellPath = join(process.cwd(), 'components', 'dashboard', 'dashboard-shell.tsx');
const workbenchPath = join(process.cwd(), 'components', 'dashboard', 'conversation-workbench.tsx');
const deskShellPath = join(process.cwd(), 'components', 'dashboard', 'conversation-desk-shell.tsx');
const previewPath = join(process.cwd(), 'components', 'dashboard', 'follow-up-preview.tsx');
const queuePath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue.tsx');
const queueHeaderPath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'queue-header.tsx');
const queueStatesPath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'queue-states.tsx');
const activityInlinePath = join(process.cwd(), 'components', 'dashboard', 'qualification-queue', 'activity-log-inline.tsx');
const ociControlPath = join(process.cwd(), 'components', 'dashboard', 'oci-control', 'oci-control-panel.tsx');
const deskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'conversations', 'page.tsx');
const todayDeskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'today-desk', 'page.tsx');
const assigneesRoutePath = join(process.cwd(), 'app', 'api', 'sites', '[siteId]', 'assignees', 'route.ts');

test('dashboard shell exposes summary navigation and follow-up preview', () => {
  const src = readFileSync(shellPath, 'utf8');
  assert.ok(src.includes('FollowUpPreview'), 'dashboard shell imports follow-up preview');
  assert.ok(src.includes("dashboard.followUpPreview"), 'dashboard shell exposes localized follow-up preview section');
  assert.ok(src.includes("dashboard.intents"), 'dashboard shell exposes localized intent navigation');
  assert.ok(src.includes("dashboard.reportsHub"), 'dashboard shell exposes localized reports navigation');
  assert.ok(src.includes('id="niyetler"'), 'dashboard shell anchors the intents section');
  assert.ok(src.includes('id="raporlar"'), 'dashboard shell anchors the reports section');
  assert.ok(src.includes('/dashboard/site/${siteId}/conversations'), 'dashboard shell links to dedicated conversation desk');
  assert.ok(src.includes('/dashboard/site/${siteId}/today-desk'), 'dashboard shell links to dedicated today desk');
});

test('follow-up preview loads compact follow-up data and links out', () => {
  const src = readFileSync(previewPath, 'utf8');
  assert.ok(src.includes('bucket=overdue'), 'preview loads overdue follow-ups');
  assert.ok(src.includes('bucket=today'), 'preview loads today follow-ups');
  assert.ok(src.includes("dashboard.openFollowUps"), 'preview exposes follow-up CTA');
  assert.ok(src.includes("dashboard.openTodayWork"), 'preview exposes today work CTA');
  assert.ok(src.includes('/dashboard/site/${siteId}/conversations'), 'preview links to follow-up page');
  assert.ok(src.includes('/dashboard/site/${siteId}/today-desk'), 'preview links to today work page');
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

test('conversation workbench uses conversation inbox and mutation APIs', () => {
  const src = readFileSync(workbenchPath, 'utf8');
  assert.ok(src.includes('/api/conversations?'), 'workbench loads inbox API');
  assert.ok(src.includes('/api/sites/${siteId}/assignees'), 'workbench loads assignee API');
  assert.ok(src.includes('useTranslation'), 'workbench is wired to i18n context');
  assert.ok(src.includes("crm.rail.deskFocus"), 'workbench exposes desk focus rail');
  assert.ok(src.includes("crm.rail.todayDesk"), 'workbench exposes today desk rail');
  assert.ok(src.includes("crm.operatorPulse.title"), 'workbench exposes operator pulse summary');
  assert.ok(src.includes("crm.rail.myDesk"), 'workbench exposes owned conversations rail');
  assert.ok(src.includes('/api/conversations/stage'), 'workbench uses stage mutation');
  assert.ok(src.includes('/api/conversations/assign'), 'workbench uses assignment mutation');
  assert.ok(src.includes('/api/conversations/follow-up'), 'workbench uses follow-up mutation');
  assert.ok(src.includes('/api/conversations/note'), 'workbench uses note mutation');
  assert.ok(src.includes('/api/conversations/reopen'), 'workbench uses reopen mutation');
  assert.ok(src.includes("crm.actions.assignMe"), 'workbench exposes assign-me quick action');
  assert.ok(src.includes("crm.actions.quick.tomorrow0930"), 'workbench exposes follow-up presets');
  assert.ok(src.includes("crm.field.operatorBrief"), 'workbench exposes operator summary strip');
  assert.ok(src.includes("crm.success.saved"), 'workbench keeps localized success feedback copy');
  assert.ok(src.includes('setBucket(card.bucket)'), 'workbench summary cards now drive inbox bucket filtering');
  assert.ok(src.includes('applySearchPreset(entry.value)'), 'workbench source badges can drive useful search filters');
  assert.ok(src.includes('navigator.clipboard.writeText'), 'workbench evidence area supports copying important IDs');
  assert.ok(src.includes("button.copy"), 'workbench exposes localized copy actions');
  assert.ok(src.includes("crm.evidence.title"), 'workbench exposes richer evidence section');
  assert.ok(src.includes("crm.evidence.primaryCall"), 'workbench exposes primary call evidence');
  assert.ok(src.includes("crm.evidence.primarySession"), 'workbench exposes primary session evidence');
  assert.ok(src.includes("crm.timeline.description"), 'workbench exposes timeline view');
});

test('oci control panel turns summary boxes into useful filters', () => {
  const src = readFileSync(ociControlPath, 'utf8');
  assert.ok(src.includes('setStatusFilter((current) => current === status ? \'\' : status)'), 'oci summary cards toggle status filtering');
  assert.ok(src.includes("ociControl.status."), 'oci panel localizes operator-facing queue statuses');
  assert.ok(src.includes("ociControl.loadMore"), 'oci panel keeps localized pagination action');
});

test('conversation desk standalone shell and page are wired', () => {
  const shellSrc = readFileSync(deskShellPath, 'utf8');
  const pageSrc = readFileSync(deskPagePath, 'utf8');
  const todayDeskSrc = readFileSync(todayDeskPagePath, 'utf8');
  assert.ok(shellSrc.includes('useTranslation'), 'desk shell is wired to i18n context');
  assert.ok(shellSrc.includes("crm.desk.title"), 'desk shell exposes localized standalone desk title');
  assert.ok(shellSrc.includes("common.backToDashboard"), 'desk shell includes localized back navigation');
  assert.ok(shellSrc.includes("dashboard.todayDesk"), 'desk shell links to today desk');
  assert.ok(shellSrc.includes('initialBucket={initialBucket}'), 'desk shell forwards bucket overrides');
  assert.ok(pageSrc.includes('ConversationDeskShell'), 'conversation desk page mounts shell');
  assert.ok(pageSrc.includes("from('site_members')"), 'conversation desk page resolves member role');
  assert.ok(todayDeskSrc.includes('ConversationDeskShell'), 'today desk page mounts shell');
  assert.ok(todayDeskSrc.includes("translate(resolvedLocale, 'crm.todayDesk.title')"), 'today desk page localizes title');
  assert.ok(todayDeskSrc.includes('initialBucket="today"'), 'today desk page defaults to today bucket');
});

test('assignees route validates access and uses admin-backed member lookup', () => {
  const src = readFileSync(assigneesRoutePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'assignees route validates site access');
  assert.ok(src.includes("from('site_members')"), 'assignees route reads site members');
  assert.ok(src.includes("from('user_emails')"), 'assignees route resolves user emails');
  assert.ok(src.includes("source: 'owner'"), 'assignees route includes owner row');
});
