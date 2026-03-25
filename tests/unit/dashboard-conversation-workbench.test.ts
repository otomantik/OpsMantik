import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shellPath = join(process.cwd(), 'components', 'dashboard', 'dashboard-shell.tsx');
const workbenchPath = join(process.cwd(), 'components', 'dashboard', 'conversation-workbench.tsx');

test('dashboard shell mounts conversation workbench above live queue', () => {
  const src = readFileSync(shellPath, 'utf8');
  assert.ok(src.includes('ConversationWorkbench'), 'dashboard shell imports conversation workbench');
  assert.ok(src.includes('<ConversationWorkbench siteId={siteId} siteRole={siteRole} />'), 'dashboard shell renders conversation workbench');
  assert.ok(src.includes('Conversation CRM'), 'dashboard shell exposes conversation CRM section');
});

test('conversation workbench uses conversation inbox and mutation APIs', () => {
  const src = readFileSync(workbenchPath, 'utf8');
  assert.ok(src.includes('/api/conversations?'), 'workbench loads inbox API');
  assert.ok(src.includes('/api/conversations/stage'), 'workbench uses stage mutation');
  assert.ok(src.includes('/api/conversations/follow-up'), 'workbench uses follow-up mutation');
  assert.ok(src.includes('/api/conversations/note'), 'workbench uses note mutation');
  assert.ok(src.includes('/api/conversations/reopen'), 'workbench uses reopen mutation');
  assert.ok(src.includes('Immutable conversation event stream'), 'workbench exposes timeline view');
});
