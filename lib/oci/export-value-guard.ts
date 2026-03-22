export type OciValueGuardResult =
  | { ok: true; normalized: number }
  | { ok: false; reason: 'NULL_VALUE' | 'NON_FINITE_VALUE' | 'NON_POSITIVE_VALUE' };

export function validateOciValueCents(raw: unknown): OciValueGuardResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: 'NULL_VALUE' };
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'NON_FINITE_VALUE' };
  }
  if (value <= 0) {
    return { ok: false, reason: 'NON_POSITIVE_VALUE' };
  }
  return { ok: true, normalized: value };
}

// Kept for call-site compatibility — both names map to the same validator.
export const validateOciQueueValueCents = validateOciValueCents;
export const validateOciSignalConversionValue = validateOciValueCents;
