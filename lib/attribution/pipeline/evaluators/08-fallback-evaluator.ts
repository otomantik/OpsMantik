import { REASON } from '../../reason-codes';
import { hasMeaningfulParams } from '../context';
import type { ClassificationContext } from '../context';

/** Direct or tagged unknown. */
export function evaluateFallback(ctx: ClassificationContext): void {
  if (ctx.terminal && ctx.verdict) return;

  if (!ctx.referrer?.trim() && !hasMeaningfulParams(ctx.parsed)) {
    ctx.verdict = {
      channel: 'direct',
      is_paid: false,
      reason_code: REASON.DIRECT_NO_SIGNALS,
      identity_grade: 'direct_unknown',
    };
    ctx.terminal = true;
    return;
  }

  if (hasMeaningfulParams(ctx.parsed) && !ctx.verdict) {
    ctx.verdict = {
      channel: 'unknown',
      is_paid: false,
      reason_code: REASON.TAGGED_UNKNOWN,
      identity_grade: 'utm_only',
    };
    ctx.terminal = true;
  }
}
