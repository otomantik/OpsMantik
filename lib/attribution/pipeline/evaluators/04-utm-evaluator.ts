import { REASON } from '../../reason-codes';
import type { ClassificationContext } from '../context';
import { pushTrace } from '../trace';

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'display', 'video']);
const SOCIAL_SOURCES = new Set([
  'facebook',
  'fb',
  'instagram',
  'ig',
  'tiktok',
  'meta',
  'linkedin',
  'twitter',
  'x',
]);

function norm(s: string | null): string {
  return (s ?? '').trim().toLowerCase();
}

/** Paid UTM + dark social UTMs when no click-id verdict yet. */
export function evaluateUtm(ctx: ClassificationContext): void {
  if (ctx.terminal) return;

  const source = norm(ctx.parsed.utm_source);
  const medium = norm(ctx.parsed.utm_medium);

  if (source === 'whatsapp' || ctx.parsed.ig_shid) {
    pushTrace(ctx, 'EVIDENCE_EVAL', 'dark social UTM signal');
    ctx.selected_evidence.push(source === 'whatsapp' ? 'utm_source=whatsapp' : 'param.ig_shid');
    ctx.verdict = {
      channel: 'dark_social',
      is_paid: false,
      reason_code: REASON.UTM_DARK_SOCIAL,
      identity_grade: 'utm_only',
    };
    ctx.terminal = true;
    return;
  }

  if (medium === 'email' || source === 'email' || source === 'newsletter') {
    ctx.verdict = {
      channel: 'email',
      is_paid: false,
      reason_code: REASON.EMAIL_UTM,
      identity_grade: 'utm_only',
    };
    ctx.terminal = true;
    return;
  }

  if (PAID_MEDIUMS.has(medium) && source) {
    const isSocial = SOCIAL_SOURCES.has(source) || medium === 'paid_social';
    pushTrace(ctx, 'EVIDENCE_EVAL', `paid UTM medium=${medium} source=${source}`);
    ctx.verdict = {
      channel: isSocial ? 'paid_social' : 'paid_search',
      is_paid: true,
      reason_code: REASON.UTM_PAID_SOCIAL,
      identity_grade: 'utm_only',
    };
    ctx.terminal = true;
  }
}
