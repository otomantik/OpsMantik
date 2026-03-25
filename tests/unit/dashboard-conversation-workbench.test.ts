import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shellPath = join(process.cwd(), 'components', 'dashboard', 'dashboard-shell.tsx');
const workbenchPath = join(process.cwd(), 'components', 'dashboard', 'conversation-workbench.tsx');
const deskShellPath = join(process.cwd(), 'components', 'dashboard', 'conversation-desk-shell.tsx');
const deskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'conversations', 'page.tsx');
const todayDeskPagePath = join(process.cwd(), 'app', 'dashboard', 'site', '[siteId]', 'today-desk', 'page.tsx');
const assigneesRoutePath = join(process.cwd(), 'app', 'api', 'sites', '[siteId]', 'assignees', 'route.ts');

test('dashboard shell mounts conversation workbench above live queue', () => {
  const src = readFileSync(shellPath, 'utf8');
  assert.ok(src.includes('ConversationWorkbench'), 'dashboard shell imports conversation workbench');
  assert.ok(src.includes('currentUserId={currentUserId}'), 'dashboard shell forwards current operator identity');
  assert.ok(src.includes('Conversation CRM'), 'dashboard shell exposes conversation CRM section');
  assert.ok(src.includes('/dashboard/site/${siteId}/conversations'), 'dashboard shell links to dedicated conversation desk');
  assert.ok(src.includes('/dashboard/site/${siteId}/today-desk'), 'dashboard shell links to dedicated today desk');
});

test('conversation workbench uses conversation inbox and mutation APIs', () => {
  const src = readFileSync(workbenchPath, 'utf8');
  assert.ok(src.includes('/api/conversations?'), 'workbench loads inbox API');
  assert.ok(src.includes('/api/sites/${siteId}/assignees'), 'workbench loads assignee API');
  assert.ok(src.includes('Desk Focus'), 'workbench exposes desk focus rail');
  assert.ok(src.includes('Today Desk'), 'workbench exposes today desk rail');
  assert.ok(src.includes('Operator Pulse'), 'workbench exposes operator pulse summary');
  assert.ok(src.includes('My Desk'), 'workbench exposes owned conversations rail');
  assert.ok(src.includes('/api/conversations/stage'), 'workbench uses stage mutation');
  assert.ok(src.includes('/api/conversations/assign'), 'workbench uses assignment mutation');
  assert.ok(src.includes('/api/conversations/follow-up'), 'workbench uses follow-up mutation');
  assert.ok(src.includes('/api/conversations/note'), 'workbench uses note mutation');
  assert.ok(src.includes('/api/conversations/reopen'), 'workbench uses reopen mutation');
  assert.ok(src.includes('Assign me'), 'workbench exposes assign-me quick action');
  assert.ok(src.includes('Tomorrow 09:30'), 'workbench exposes follow-up presets');
  assert.ok(src.includes('Operator brief'), 'workbench exposes operator summary strip');
  assert.ok(src.includes('Saved'), 'workbench keeps success feedback copy');
  assert.ok(src.includes('Evidence Stack'), 'workbench exposes richer evidence section');
  assert.ok(src.includes('Primary call'), 'workbench exposes primary call evidence');
  assert.ok(src.includes('Primary session'), 'workbench exposes primary session evidence');
  assert.ok(src.includes('Immutable conversation event stream'), 'workbench exposes timeline view');
});

test('conversation desk standalone shell and page are wired', () => {
  const shellSrc = readFileSync(deskShellPath, 'utf8');
  const pageSrc = readFileSync(deskPagePath, 'utf8');
  const todayDeskSrc = readFileSync(todayDeskPagePath, 'utf8');
  assert.ok(shellSrc.includes('Conversation Desk'), 'desk shell exposes standalone conversation desk title');
  assert.ok(shellSrc.includes('Back to Dashboard'), 'desk shell includes back navigation');
  assert.ok(shellSrc.includes('Today Desk'), 'desk shell links to today desk');
  assert.ok(shellSrc.includes('initialBucket={initialBucket}'), 'desk shell forwards bucket overrides');
  assert.ok(pageSrc.includes('ConversationDeskShell'), 'conversation desk page mounts shell');
  assert.ok(pageSrc.includes("from('site_members')"), 'conversation desk page resolves member role');
  assert.ok(todayDeskSrc.includes('ConversationDeskShell'), 'today desk page mounts shell');
  assert.ok(todayDeskSrc.includes('initialBucket="today"'), 'today desk page defaults to today bucket');
});

test('assignees route validates access and uses admin-backed member lookup', () => {
  const src = readFileSync(assigneesRoutePath, 'utf8');
  assert.ok(src.includes('validateSiteAccess'), 'assignees route validates site access');
  assert.ok(src.includes("from('site_members')"), 'assignees route reads site members');
  assert.ok(src.includes("from('user_emails')"), 'assignees route resolves user emails');
  assert.ok(src.includes("source: 'owner'"), 'assignees route includes owner row');
});
