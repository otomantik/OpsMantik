export type SiteRole = 'owner' | 'admin' | 'operator' | 'analyst' | 'billing';

export type Capability =
  | 'site:write'
  | 'members:manage'
  | 'queue:operate' // seal/junk/undo/cancel
  | 'billing:view';

export function capabilitiesForRole(role: SiteRole): Set<Capability> {
  // Least privilege by default.
  if (role === 'owner') return new Set<Capability>(['site:write', 'members:manage', 'queue:operate', 'billing:view']);
  if (role === 'admin') return new Set<Capability>(['site:write', 'members:manage', 'queue:operate', 'billing:view']);
  if (role === 'operator') return new Set<Capability>(['queue:operate']);
  if (role === 'billing') return new Set<Capability>(['billing:view']);
  // analyst
  return new Set<Capability>([]);
}

export function hasCapability(role: SiteRole, cap: Capability): boolean {
  return capabilitiesForRole(role).has(cap);
}

