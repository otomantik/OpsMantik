type AuthLikeUser = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

function normalizeRole(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function roleFromUserMetadata(user: AuthLikeUser | null | undefined): string {
  if (!user) return '';
  const appRole = normalizeRole(user.app_metadata?.role);
  if (appRole) return appRole;
  return normalizeRole(user.user_metadata?.role);
}

export function isAdminRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'super_admin' || normalized === 'superadmin';
}

/**
 * Single admin authority used by middleware/pages/APIs.
 * Primary truth is DB profile role, with metadata as compatibility bridge.
 */
export function resolvePlatformAdmin(
  profileRole: unknown,
  user: AuthLikeUser | null | undefined
): boolean {
  if (isAdminRole(profileRole)) return true;
  return isAdminRole(roleFromUserMetadata(user));
}
