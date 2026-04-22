import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';
import { logWarn } from '@/lib/logging/logger';

type VersionState = 'valid' | 'missing' | 'zero' | 'invalid';

export type MutationVersionResolution =
  | { ok: true; version: number; state: VersionState; bypassUsed: boolean }
  | { ok: false; state: VersionState };

function parseVersion(raw: unknown): { state: VersionState; value: number | null } {
  if (raw == null) return { state: 'missing', value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { state: 'invalid', value: null };
  const v = Math.round(n);
  if (v === 0) return { state: 'zero', value: 0 };
  if (v < 0) return { state: 'invalid', value: null };
  return { state: 'valid', value: v };
}

function asUtcMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function canUseCompatBypass(input: {
  headers: Headers;
  siteId: string;
  route: string;
  requestId?: string;
}): boolean {
  const requested = input.headers.get('x-ops-compat-version-bypass') === '1';
  if (!requested) return false;

  const until = asUtcMs(process.env.COMPAT_VERSION_BYPASS_UNTIL);
  if (until == null || Date.now() > until) return false;

  const allowlist = parseAllowlist(process.env.COMPAT_VERSION_BYPASS_TENANT_ALLOWLIST);
  if (!allowlist.has(input.siteId)) return false;

  const startRelease = Number(process.env.COMPAT_VERSION_BYPASS_START_RELEASE ?? '0');
  const currentRelease = Number(process.env.OPSMANTIK_RELEASE_NUMBER ?? '0');
  if (
    Number.isFinite(startRelease) &&
    Number.isFinite(currentRelease) &&
    currentRelease - startRelease >= 2
  ) {
    return false;
  }

  const remainingDays = Math.max(0, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000)));
  incrementRefactorMetric('mutation_compat_bypass_used_total');
  logWarn('compat_bypass_used', {
    route: input.route,
    site_id: input.siteId,
    request_id: input.requestId,
    remaining_days: remainingDays,
    client_signature: input.headers.get('x-client-signature') ?? null,
  });
  return true;
}

export function resolveMutationVersion(input: {
  rawVersion: unknown;
  route: string;
  siteId: string;
  requestHeaders: Headers;
  fallbackVersion: number | null;
  requestId?: string;
}): MutationVersionResolution {
  const parsed = parseVersion(input.rawVersion);
  if (parsed.state === 'valid' && (parsed.value ?? 0) >= 1) {
    return { ok: true, version: parsed.value as number, state: 'valid', bypassUsed: false };
  }

  if (parsed.state === 'missing') incrementRefactorMetric('mutation_version_missing_total');
  else if (parsed.state === 'zero') incrementRefactorMetric('mutation_version_zero_total');
  else incrementRefactorMetric('mutation_version_invalid_total');

  const { strict_mutation_version_enforce } = getRefactorFlags();
  if (!strict_mutation_version_enforce) {
    if (input.fallbackVersion != null && input.fallbackVersion >= 1) {
      return {
        ok: true,
        version: input.fallbackVersion,
        state: parsed.state,
        bypassUsed: false,
      };
    }
    return { ok: false, state: parsed.state };
  }

  if (
    input.fallbackVersion != null &&
    input.fallbackVersion >= 1 &&
    canUseCompatBypass({
      headers: input.requestHeaders,
      route: input.route,
      siteId: input.siteId,
      requestId: input.requestId,
    })
  ) {
    return {
      ok: true,
      version: input.fallbackVersion,
      state: parsed.state,
      bypassUsed: true,
    };
  }

  return { ok: false, state: parsed.state };
}
