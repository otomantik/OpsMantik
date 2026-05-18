import { sanitizeClickId } from '@/lib/attribution';
import { CONTRADICTION, REASON } from '../../reason-codes';
import type { ClassificationContext } from '../context';
import { pushTrace } from '../trace';

function normSource(s: string | null): string {
  return (s ?? '').trim().toLowerCase();
}

/** R-CLICK-SUPREMACY + R-UTM-CONFLICT */
export function evaluateClickId(ctx: ClassificationContext): void {
  if (ctx.terminal) return;

  const gclid = sanitizeClickId(ctx.parsed.gclid);
  const wbraid = sanitizeClickId(ctx.parsed.wbraid);
  const gbraid = sanitizeClickId(ctx.parsed.gbraid);

  ctx.sanitized = { gclid, wbraid, gbraid };

  if (!gclid && !wbraid && !gbraid) {
    if (ctx.parsed.gclid && ctx.parsed.gclid.length < 10) {
      ctx.ignored_evidence.push('param.gclid_invalid_length');
      pushTrace(ctx, 'EVIDENCE_EVAL', 'gclid rejected — failed sanitize');
    }
    return;
  }

  const reason = gclid
    ? REASON.GOOGLE_GCLID_VALID
    : wbraid
      ? REASON.GOOGLE_WBRAID_VALID
      : REASON.GOOGLE_GBRAID_VALID;

  pushTrace(ctx, 'EVIDENCE_EVAL', 'Found valid Google click-id');
  ctx.selected_evidence.push(gclid ? 'param.gclid_valid' : wbraid ? 'param.wbraid_valid' : 'param.gbraid_valid');

  let channel: import('../../truth-engine-types').TrafficChannel = 'paid_search';
  const utmSource = normSource(ctx.parsed.utm_source);
  const conflictingUtm =
    utmSource &&
    utmSource !== 'google' &&
    utmSource !== 'googleads' &&
    !utmSource.includes('google');

  if (conflictingUtm) {
    pushTrace(ctx, 'CONFLICT_RES', `Click-ID overrides utm_source=${utmSource}`);
    ctx.ignored_evidence.push(`utm_source=${ctx.parsed.utm_source}`);
    ctx.contradiction_reasons.push(CONTRADICTION.UTM_CONTRADICTS_CLICK_ID);
    ctx.contradiction_score = Math.max(ctx.contradiction_score, 0.75);
  }

  const identity_grade = gclid
    ? 'click_id_strong'
    : wbraid || gbraid
      ? 'click_id_ios'
      : 'click_id_strong';

  ctx.verdict = {
    channel,
    is_paid: true,
    reason_code: reason,
    identity_grade,
  };
  ctx.terminal = true;
}
