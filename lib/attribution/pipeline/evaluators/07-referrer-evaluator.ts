import { REASON } from '../../reason-codes';
import type { ClassificationContext } from '../context';
import { pushTrace } from '../trace';

const AI_HOSTS = ['chatgpt.com', 'perplexity.ai', 'claude.ai'] as const;

const SEARCH_HOST_MARKERS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'yandex.'] as const;

const SOCIAL_HOST_MARKERS = [
  'facebook.',
  'instagram.',
  'twitter.',
  'x.com',
  't.co',
  'tiktok.',
  'linkedin.',
  'youtube.',
  'pinterest.',
] as const;

function hostMatches(host: string, markers: readonly string[]): boolean {
  const h = host.toLowerCase();
  return markers.some((m) => h === m || h.endsWith('.' + m) || h.includes(m));
}

/** R-MAPS, R-AI, organic search, social, referral */
export function evaluateReferrer(ctx: ClassificationContext): void {
  if (ctx.terminal) return;
  const host = ctx.referrerHost;
  if (!host) return;

  if (
    host.includes('business.google') ||
    host.includes('local.google') ||
    host.includes('maps.google') ||
    host === 'g.page' ||
    host.endsWith('.g.page')
  ) {
    pushTrace(ctx, 'EVIDENCE_EVAL', `maps referrer host=${host}`);
    ctx.selected_evidence.push(`referrer.host=${host}`);
    ctx.verdict = {
      channel: 'local_maps',
      is_paid: false,
      reason_code: REASON.MAPS_REFERRER,
      identity_grade: 'referrer_only',
    };
    ctx.terminal = true;
    return;
  }

  for (const ai of AI_HOSTS) {
    if (host === ai || host.endsWith('.' + ai) || host.includes(ai)) {
      pushTrace(ctx, 'EVIDENCE_EVAL', `AI referrer host=${host}`);
      ctx.verdict = {
        channel: 'ai_referral',
        is_paid: false,
        reason_code: REASON.AI_REFERRER,
        identity_grade: 'referrer_only',
      };
      ctx.terminal = true;
      return;
    }
  }

  if (hostMatches(host, SEARCH_HOST_MARKERS) && !host.includes('maps')) {
    ctx.verdict = {
      channel: 'organic_search',
      is_paid: false,
      reason_code: REASON.ORGANIC_SEARCH_REFERRER,
      identity_grade: 'referrer_only',
    };
    ctx.terminal = true;
    return;
  }

  if (hostMatches(host, SOCIAL_HOST_MARKERS)) {
    ctx.verdict = {
      channel: 'organic_social',
      is_paid: false,
      reason_code: REASON.ORGANIC_SOCIAL_REFERRER,
      identity_grade: 'referrer_only',
    };
    ctx.terminal = true;
    return;
  }

  ctx.verdict = {
    channel: 'referral',
    is_paid: false,
    reason_code: REASON.REFERRAL_HOST,
    identity_grade: 'referrer_only',
  };
  ctx.terminal = true;
}
