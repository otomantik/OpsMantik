import { describe, expect, test } from 'vitest';
import { capabilitiesForRole, hasCapability, type SiteRole } from '@/lib/auth/rbac';

describe('RBAC v2 capability mapping', () => {
  test('owner has all capabilities', () => {
    const caps = capabilitiesForRole('owner');
    expect(caps.has('members:manage')).toBe(true);
    expect(caps.has('site:write')).toBe(true);
    expect(caps.has('queue:operate')).toBe(true);
    expect(caps.has('billing:view')).toBe(true);
  });

  test('admin has members + site write + queue operate', () => {
    expect(hasCapability('admin', 'members:manage')).toBe(true);
    expect(hasCapability('admin', 'site:write')).toBe(true);
    expect(hasCapability('admin', 'queue:operate')).toBe(true);
  });

  test('operator can operate queue only', () => {
    expect(hasCapability('operator', 'queue:operate')).toBe(true);
    expect(hasCapability('operator', 'members:manage')).toBe(false);
    expect(hasCapability('operator', 'site:write')).toBe(false);
    expect(hasCapability('operator', 'billing:view')).toBe(false);
  });

  test('analyst is read-only', () => {
    const role: SiteRole = 'analyst';
    expect(hasCapability(role, 'queue:operate')).toBe(false);
    expect(hasCapability(role, 'members:manage')).toBe(false);
    expect(hasCapability(role, 'site:write')).toBe(false);
  });

  test('billing can only view billing', () => {
    expect(hasCapability('billing', 'billing:view')).toBe(true);
    expect(hasCapability('billing', 'queue:operate')).toBe(false);
  });
});

