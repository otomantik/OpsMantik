/**
 * PR-9I — Universal offline conversion click-id selection for Google Ads Script lane.
 * Priority: gclid > wbraid > gbraid. Exactly one non-empty click identifier per upload row.
 * Keep `GoogleAdsScriptUniversal.js` click-id selection aligned with this module.
 */

export type SelectedClickIdType = 'gclid' | 'wbraid' | 'gbraid';

export type ResolveUploadIdentifierInput = {
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
};

export type ResolveUploadIdentifierResult = {
  valid: boolean;
  reason: string | null;
  selectedType: SelectedClickIdType | null;
  selectedValue: string;
  hadGclid: boolean;
  hadWbraid: boolean;
  hadGbraid: boolean;
  multipleClickIds: boolean;
};

function trimId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Resolve which single click identifier to send on the offline conversion row.
 * Hashed-phone-only rows are invalid for the Script bulk-upload lane until a dedicated lane exists.
 */
export function resolveUploadIdentifier(
  row: ResolveUploadIdentifierInput,
  options?: { hasVerifiedHashedPhoneCourier?: boolean }
): ResolveUploadIdentifierResult {
  const g = trimId(row.gclid);
  const w = trimId(row.wbraid);
  const gb = trimId(row.gbraid);
  const hadGclid = g.length > 0;
  const hadWbraid = w.length > 0;
  const hadGbraid = gb.length > 0;
  const nPresent = (hadGclid ? 1 : 0) + (hadWbraid ? 1 : 0) + (hadGbraid ? 1 : 0);
  const multipleClickIds = nPresent > 1;

  let selectedType: SelectedClickIdType | null = null;
  let selectedValue = '';
  if (hadGclid) {
    selectedType = 'gclid';
    selectedValue = g;
  } else if (hadWbraid) {
    selectedType = 'wbraid';
    selectedValue = w;
  } else if (hadGbraid) {
    selectedType = 'gbraid';
    selectedValue = gb;
  }

  if (selectedType) {
    return {
      valid: true,
      reason: null,
      selectedType,
      selectedValue,
      hadGclid,
      hadWbraid,
      hadGbraid,
      multipleClickIds,
    };
  }

  const hp = options?.hasVerifiedHashedPhoneCourier === true;
  if (hp) {
    return {
      valid: false,
      reason: 'HASHED_PHONE_ONLY_SCRIPT_LANE_UNSUPPORTED',
      selectedType: null,
      selectedValue: '',
      hadGclid,
      hadWbraid,
      hadGbraid,
      multipleClickIds: false,
    };
  }

  return {
    valid: false,
    reason: 'MISSING_CLICK_ID',
    selectedType: null,
    selectedValue: '',
    hadGclid,
    hadWbraid,
    hadGbraid,
    multipleClickIds: false,
  };
}
