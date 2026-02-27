/**
 * Brain Score Engine V1: Rule-based lead scoring.
 * Evaluates lead quality (0-100) based on device, action, and ads context.
 */

import { type AdsContext } from './call-event-worker-payload';

export type ScoringPayload = {
    ua?: string | null;
    intent_action: string;
};

export type ScoreResult = {
    score: number;
    breakdown: Record<string, string>;
};

/**
 * Calculates a lead score (0-100) based on predefined rules.
 * Rules:
 * - Base Score: 10
 * - Device: iPhone/Mac OS (+20), Android/Windows (+10)
 * - Action: WhatsApp (+40), Phone (+30), Click/Copy (+15)
 * - Ads Context: Has Keyword (+15), Has Geo Target (+15)
 */
export function calculateBrainScore(
    payload: ScoringPayload,
    adsContext?: AdsContext | null
): ScoreResult {
    let score = 10;
    const breakdown: Record<string, string> = { base: '+10 (Base)' };

    // 1. Device Rules
    const ua = payload.ua || '';
    if (/iPhone|Mac OS|Macintosh/i.test(ua)) {
        score += 20;
        breakdown.device = '+20 (Apple)';
    } else if (/Android|Windows/i.test(ua)) {
        score += 10;
        breakdown.device = '+10 (Android/Windows)';
    }

    // 2. Action Rules
    const action = (payload.intent_action || '').toLowerCase();
    if (action === 'whatsapp') {
        score += 40;
        breakdown.action = '+40 (WhatsApp)';
    } else if (action === 'phone' || action === 'call') {
        score += 30;
        breakdown.action = '+30 (Phone)';
    } else if (action === 'click' || action === 'copy') {
        score += 15;
        breakdown.action = '+15 (Click/Copy)';
    }

    // 3. Ads Context Rules
    if (adsContext) {
        if (adsContext.keyword) {
            score += 15;
            breakdown.ads_keyword = '+15 (Has Keyword)';
        }
        if (adsContext.geo_target_id) {
            score += 15;
            breakdown.ads_geo = '+15 (Rich Geo Data)';
        }
    }

    return {
        score: Math.min(100, score),
        breakdown,
    };
}
