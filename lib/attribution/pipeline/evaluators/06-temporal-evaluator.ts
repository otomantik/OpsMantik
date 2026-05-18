import { REASON } from '../../reason-codes';
import { isDirectShapedLanding } from '../context';
import type { ClassificationContext } from '../context';
import { pushTrace } from '../trace';

const DARK_RETURN_MS = 24 * 60 * 60 * 1000;

/** R-DARK-RETURN */
export function evaluateTemporal(ctx: ClassificationContext): void {
  if (ctx.terminal) return;
  if (!isDirectShapedLanding(ctx.referrer, ctx.parsed)) return;

  const prev = ctx.previousSession;
  if (!prev || prev.channel !== 'paid_search') {
    pushTrace(ctx, 'TEMPORAL', 'no qualifying prior paid_search session');
    return;
  }

  const ageMs = Date.now() - prev.timestamp;
  if (ageMs > DARK_RETURN_MS) {
    pushTrace(ctx, 'TEMPORAL', `prior paid_search too old (${Math.round(ageMs / 3600000)}h)`);
    return;
  }

  pushTrace(ctx, 'TEMPORAL', 'dark return within 24h of paid_search');
  ctx.selected_evidence.push('temporal.dark_return_24h');
  ctx.verdict = {
    channel: 'dark_return',
    is_paid: true,
    reason_code: REASON.TEMPORAL_DARK_RETURN,
    identity_grade: 'click_id_assisted',
  };
  ctx.terminal = true;
}
