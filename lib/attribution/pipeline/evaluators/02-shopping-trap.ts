import { REASON } from '../../reason-codes';
import type { ClassificationContext } from '../context';
import { setTerminalVerdict } from '../context';
import { pushTrace } from '../trace';

/** R-ORG-SHOP: srsltid → organic_shopping, never paid. */
export function evaluateShoppingTrap(ctx: ClassificationContext): void {
  if (ctx.terminal) return;
  if (!ctx.parsed.srsltid) return;

  pushTrace(ctx, 'EVIDENCE_EVAL', 'srsltid present — organic shopping trap');
  ctx.selected_evidence.push('param.srsltid');
  setTerminalVerdict(ctx, {
    channel: 'organic_shopping',
    is_paid: false,
    reason_code: REASON.GOOGLE_SRSLTID_ORGANIC_SHOPPING,
    identity_grade: 'referrer_only',
  });
}
