/**
 * PR2: consent provenance shadow verification (metrics only; no enforcement).
 */

import { adminClient } from '@/lib/supabase/admin';
import { getRefactorFlags } from '@/lib/refactor/flags';
import { incrementRefactorMetric } from '@/lib/refactor/metrics';

export type ConsentProvenanceStored = {
  source?: string;
  policy_version?: string | null;
  updated_via?: string;
  recorded_at_client?: string | null;
};

export type SessionConsentSnapshot = {
  consent_scopes: string[] | null;
  consent_at: string | null;
  consent_provenance: ConsentProvenanceStored | unknown | null;
};

function normalizeScopeArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase());
}

function provenanceSource(raw: unknown): 'cmp' | 'manual' | 'unknown' {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown';
  const s = (raw as Record<string, unknown>).source;
  if (s === 'cmp' || s === 'manual') return s;
  return 'unknown';
}

export type ShadowOutcome =
  | 'missing_session'
  | 'mismatch'
  | 'low_trust'
  | 'info_payload_no_analytics_session_yes'
  | 'ok'
  | 'noop';

/**
 * Priority: missing_session > mismatch > low_trust > info > ok > noop.
 */
export function evaluateConsentProvenanceShadow(args: {
  payloadClaimsAnalytics: boolean;
  session: SessionConsentSnapshot | null;
}): ShadowOutcome {
  const { payloadClaimsAnalytics, session } = args;
  if (!session) return 'missing_session';

  const scopes = normalizeScopeArray(session.consent_scopes);
  const sessionHasAnalytics = scopes.includes('analytics');

  if (payloadClaimsAnalytics) {
    if (!sessionHasAnalytics) return 'mismatch';
    if (session.consent_at == null || String(session.consent_at).trim() === '') return 'mismatch';
    if (provenanceSource(session.consent_provenance) === 'unknown') return 'low_trust';
    return 'ok';
  }

  if (sessionHasAnalytics) return 'info_payload_no_analytics_session_yes';

  return 'noop';
}

export function applyConsentProvenanceShadowMetrics(outcome: ShadowOutcome): void {
  incrementRefactorMetric('consent_provenance_shadow_check_total');
  switch (outcome) {
    case 'missing_session':
      incrementRefactorMetric('consent_provenance_shadow_missing_session_total');
      break;
    case 'mismatch':
      incrementRefactorMetric('consent_provenance_shadow_mismatch_total');
      break;
    case 'low_trust':
      incrementRefactorMetric('consent_provenance_shadow_low_trust_total');
      break;
    case 'info_payload_no_analytics_session_yes':
      incrementRefactorMetric('consent_provenance_shadow_payload_no_analytics_session_yes_total');
      break;
    case 'ok':
      incrementRefactorMetric('consent_provenance_shadow_ok_total');
      break;
    default:
      break;
  }
}

/** Raw row from sessions select (shadow fields only). */
export type SessionConsentShadowRow = {
  consent_scopes: unknown;
  consent_at: unknown;
  consent_provenance: unknown;
};

async function defaultFetchSessionConsentForShadow(
  siteId: string,
  sessionId: string,
  createdMonth: string
): Promise<SessionConsentShadowRow | null> {
  const { data } = await adminClient
    .from('sessions')
    .select('consent_scopes, consent_at, consent_provenance')
    .eq('site_id', siteId)
    .eq('id', sessionId)
    .eq('created_month', createdMonth)
    .maybeSingle();
  return data ?? null;
}

/**
 * Sync worker: after session is resolved, re-read consent fields and emit shadow metrics.
 * No-op when CONSENT_PROVENANCE_SHADOW_ENABLED is off.
 * @param fetchRow — inject for unit tests (default uses adminClient).
 */
export async function runConsentProvenanceShadowForResolvedSession(
  siteId: string,
  session: { id: string; created_month: string },
  payloadClaimsAnalytics: boolean,
  fetchRow: (
    siteId: string,
    sessionId: string,
    createdMonth: string
  ) => Promise<SessionConsentShadowRow | null> = defaultFetchSessionConsentForShadow
): Promise<void> {
  if (!getRefactorFlags().consent_provenance_shadow_enabled) return;

  const consentRow = await fetchRow(siteId, session.id, session.created_month);
  const outcome = evaluateConsentProvenanceShadow({
    payloadClaimsAnalytics,
    session: consentRow
      ? {
          consent_scopes: consentRow.consent_scopes as string[] | null,
          consent_at: (consentRow.consent_at as string | null) ?? null,
          consent_provenance: consentRow.consent_provenance,
        }
      : null,
  });
  applyConsentProvenanceShadowMetrics(outcome);
}

/**
 * Parse optional `provenance` on POST /api/gdpr/consent. Malformed → defaults + malformed flag (never throw).
 */
export function parseOptionalConsentProvenance(body: Record<string, unknown>): {
  object: ConsentProvenanceStored;
  malformed: boolean;
} {
  const raw = body.provenance;
  if (raw === undefined || raw === null) {
    return {
      object: { source: 'unknown', policy_version: null, updated_via: 'gdpr_consent_api' },
      malformed: false,
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      object: { source: 'unknown', policy_version: null, updated_via: 'gdpr_consent_api' },
      malformed: true,
    };
  }
  const rec = raw as Record<string, unknown>;
  let malformed = false;
  let source: 'cmp' | 'manual' | 'unknown' = 'unknown';
  if (rec.source !== undefined && rec.source !== null) {
    if (typeof rec.source === 'string') {
      const t = rec.source.trim().toLowerCase();
      if (t === 'cmp' || t === 'manual') source = t;
      else if (t === 'unknown') source = 'unknown';
      else malformed = true;
    } else {
      malformed = true;
    }
  }
  let policy_version: string | null = null;
  if (rec.policy_version !== undefined && rec.policy_version !== null) {
    if (typeof rec.policy_version === 'string') policy_version = rec.policy_version.slice(0, 128);
    else malformed = true;
  }
  let recorded_at_client: string | null = null;
  if (rec.recorded_at_client !== undefined && rec.recorded_at_client !== null) {
    if (typeof rec.recorded_at_client === 'string') recorded_at_client = rec.recorded_at_client.slice(0, 64);
    else malformed = true;
  }
  return {
    object: {
      source,
      policy_version,
      updated_via: 'gdpr_consent_api',
      recorded_at_client,
    },
    malformed,
  };
}
