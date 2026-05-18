import { isCommonBotUA } from '@/lib/ingest/bot-referrer-gates';
import { isFraudReferrerHost } from '../../fraud-referrer-registry';
import { REASON } from '../../reason-codes';
import type { ClassificationContext } from '../context';
import { setTerminalVerdict } from '../context';
import { pushTrace } from '../trace';

function isHeadlessOrLinuxBotUa(ua: string): boolean {
  const u = ua.toLowerCase();
  if (isCommonBotUA(ua)) return true;
  if (/headless/i.test(u)) return true;
  if (/linux/i.test(u) && !/android/i.test(u) && /x11|headless|phantom/i.test(u)) return true;
  return false;
}

/** R-FRAUD-VETO: click-id param + bot UA or fraud referrer. */
export function evaluateFraud(ctx: ClassificationContext): void {
  if (ctx.terminal) return;
  if (!ctx.hasRawClickIdParam) return;

  const botUa = isHeadlessOrLinuxBotUa(ctx.userAgent);
  const fraudRef = isFraudReferrerHost(ctx.referrerHost);
  if (!botUa && !fraudRef) return;

  pushTrace(ctx, 'FRAUD_GATE', 'Poisoned click-id — bot UA or fraud referrer');
  ctx.is_fraud_suspected = true;
  ctx.selected_evidence.push(botUa ? 'ua.bot_or_headless' : 'referrer.fraud_host');
  if (ctx.parsed.gclid) ctx.selected_evidence.push('param.gclid');
  setTerminalVerdict(ctx, {
    channel: 'fraudulent_signal',
    is_paid: false,
    reason_code: REASON.FRAUD_POISONED_CLICK_ID,
    identity_grade: 'direct_unknown',
  });
}
