import { REASON } from '../../reason-codes';
import { isDirectShapedLanding } from '../context';
import type { ClassificationContext } from '../context';
import { pushTrace } from '../trace';

const IN_APP_UA_MARKERS = ['instagram', 'fbios', 'whatsapp', 'tiktok'] as const;

function matchesInAppUa(ua: string): boolean {
  const u = ua.toLowerCase();
  return IN_APP_UA_MARKERS.some((m) => u.includes(m));
}

/** R-UA-WHISPER */
export function evaluateUaWhisper(ctx: ClassificationContext): void {
  if (ctx.terminal) return;
  if (!isDirectShapedLanding(ctx.referrer, ctx.parsed) && ctx.referrer?.trim()) return;
  if (!matchesInAppUa(ctx.userAgent)) return;

  pushTrace(ctx, 'UA_WHISPER', 'In-app browser detected');
  ctx.selected_evidence.push('ua.in_app_browser');
  ctx.verdict = {
    channel: 'dark_social',
    is_paid: false,
    reason_code: REASON.UA_IN_APP_BROWSER,
    identity_grade: 'referrer_only',
  };
  ctx.terminal = true;
}
