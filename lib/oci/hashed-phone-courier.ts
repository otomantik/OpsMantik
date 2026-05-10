/**
 * PR-9H.7D — Server-side prehashed phone courier for Google Ads export (script/API consumers).
 * Never accepts or emits raw phone; never hashes raw phone here — courier-only normalization of existing SHA-256 hex.
 */

import { isSha256Hex } from '@/lib/oci/validation/crypto';
import type { GoogleAdsConversionItem, QueueRow } from '@/lib/oci/google-ads-export/types';

/** Safe, non-PII provenance labels for diagnostics aggregates only. */
export type HashedPhoneCourierSource =
  | 'queue_user_identifiers_flat_hashed_phone'
  | 'queue_user_identifiers_flat_hashedPhoneNumber'
  | 'queue_user_identifiers_array_entry'
  | 'caller_phone_hash_sha256'
  | null;

/**
 * Normalize server-supplied SHA-256 hex: accept only 64-char hex (case-insensitive), return lowercase.
 */
export function normalizeServerHashedPhone(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  const lower = s.toLowerCase();
  return isSha256Hex(lower) ? lower : null;
}

export function parseUserIdentifiersBlob(raw: unknown): Record<string, unknown> | unknown[] | null {
  if (raw == null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw) as unknown;
      if (typeof j === 'object' && j !== null) return j as Record<string, unknown> | unknown[];
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return null;
}

function tryHexFromArrayEntries(entries: unknown[]): { hash: string | null; invalidAdds: number } {
  let invalidAdds = 0;
  for (const ent of entries) {
    if (!ent || typeof ent !== 'object') continue;
    const o = ent as Record<string, unknown>;
    const tpe = typeof o.type === 'string' ? o.type.trim().toLowerCase() : '';
    const val = o.value;
    if (tpe !== 'hashed_phone') continue;
    const norm = normalizeServerHashedPhone(val);
    if (norm) return { hash: norm, invalidAdds };
    if (val != null && String(val).trim()) invalidAdds += 1;
  }
  return { hash: null, invalidAdds };
}

/**
 * Extract courier hash from queue row + optional call projection hash.
 * Resolution order aligns with PR-9H.7A/7C: queue flat fields → courier array shapes → call hash.
 */
export function extractHashedPhoneFromExportSources(params: {
  row: QueueRow;
  callerPhoneHashSha256?: string | null;
}): {
  hashedPhoneNumber: string | null;
  source: HashedPhoneCourierSource;
  invalidAdds: number;
} {
  let invalidAdds = 0;
  const blob = parseUserIdentifiersBlob(params.row.user_identifiers);

  const tryCandidate = (raw: unknown): string | null => {
    const norm = normalizeServerHashedPhone(raw);
    if (norm) return norm;
    if (raw != null && String(raw).trim()) invalidAdds += 1;
    return null;
  };

  if (blob && !Array.isArray(blob)) {
    const uid = blob as Record<string, unknown>;
    const h1 = tryCandidate(uid.hashed_phone);
    if (h1) return { hashedPhoneNumber: h1, source: 'queue_user_identifiers_flat_hashed_phone', invalidAdds };
    const h2 = tryCandidate(uid.hashedPhoneNumber);
    if (h2) return { hashedPhoneNumber: h2, source: 'queue_user_identifiers_flat_hashedPhoneNumber', invalidAdds };

    const nestedArrays: unknown[] = [];
    if (Array.isArray(uid.userIdentifiers)) nestedArrays.push(...uid.userIdentifiers);
    if (Array.isArray(uid.user_identifiers)) nestedArrays.push(...uid.user_identifiers);
    if (nestedArrays.length) {
      const arrRes = tryHexFromArrayEntries(nestedArrays);
      invalidAdds += arrRes.invalidAdds;
      if (arrRes.hash) return { hashedPhoneNumber: arrRes.hash, source: 'queue_user_identifiers_array_entry', invalidAdds };
    }
  }

  if (Array.isArray(blob)) {
    const arrRes = tryHexFromArrayEntries(blob);
    invalidAdds += arrRes.invalidAdds;
    if (arrRes.hash) return { hashedPhoneNumber: arrRes.hash, source: 'queue_user_identifiers_array_entry', invalidAdds };
  }

  const fromCall = normalizeServerHashedPhone(params.callerPhoneHashSha256);
  if (fromCall) {
    return { hashedPhoneNumber: fromCall, source: 'caller_phone_hash_sha256', invalidAdds };
  }
  if (params.callerPhoneHashSha256 != null && String(params.callerPhoneHashSha256).trim()) {
    invalidAdds += 1;
  }

  return { hashedPhoneNumber: null, source: null, invalidAdds };
}

/** Optional hashed email on queue blob (64-char hex only). */
export function extractEmailHashFromQueueRow(row: QueueRow): string | null {
  const blob = parseUserIdentifiersBlob(row.user_identifiers);
  if (!blob || Array.isArray(blob)) return null;
  const u = blob as Record<string, unknown>;
  const e = typeof u.hashed_email === 'string' ? u.hashed_email.trim().toLowerCase() : '';
  return isSha256Hex(e) ? e : null;
}

/** Attach normalized courier fields to export item (idempotent for hashed_phone entry). */
export function appendHashedPhoneCourier(
  item: GoogleAdsConversionItem,
  hash: string
): GoogleAdsConversionItem {
  const h = normalizeServerHashedPhone(hash);
  if (!h) return item;
  const existing = [...(item.userIdentifiers ?? item.user_identifiers ?? [])];
  if (!existing.some((x) => x.type === 'hashed_phone')) {
    existing.push({ type: 'hashed_phone', value: h });
  }
  return {
    ...item,
    hashedPhoneNumber: h,
    hashed_phone_number: h,
    userIdentifiers: existing,
    user_identifiers: existing,
  };
}
