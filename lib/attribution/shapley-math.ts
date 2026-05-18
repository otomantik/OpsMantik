/**
 * Phase 1 — Deterministic Shapley marginal contribution (Value Truth shadow).
 */

import type { TrafficChannel } from './truth-engine-types';

const CHANNEL_WEIGHT: Record<TrafficChannel, number> = {
  paid_search: 1.0,
  paid_social: 0.85,
  dark_return: 0.9,
  local_maps: 0.55,
  organic_search: 0.45,
  organic_shopping: 0.4,
  ai_referral: 0.35,
  email: 0.3,
  organic_social: 0.25,
  dark_social: 0.2,
  referral: 0.2,
  direct: 0.1,
  fraudulent_signal: 0,
  unknown: 0.05,
};

const MAX_TOUCHPOINTS = 8;

function coalitionValue(channels: TrafficChannel[], total: number): number {
  if (channels.length === 0) return 0;
  const w = channels.reduce((s, c) => s + (CHANNEL_WEIGHT[c] ?? 0.1), 0);
  return (total * w) / Math.max(channels.length, 1);
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) {
      out.push([arr[i], ...p]);
    }
  }
  return out;
}

/**
 * Exact Shapley for n≤8 touchpoints; sums to conversionValue (minor units).
 */
export function calculateMarginalContribution(
  touchpoints: TrafficChannel[],
  conversionValue: number
): Partial<Record<TrafficChannel, number>> {
  const unique = [...new Set(touchpoints)].slice(0, MAX_TOUCHPOINTS);
  const n = unique.length;
  if (n === 0) return {};
  if (conversionValue <= 0) {
    return Object.fromEntries(unique.map((c) => [c, 0])) as Partial<Record<TrafficChannel, number>>;
  }

  const phi: Partial<Record<TrafficChannel, number>> = {};
  for (const ch of unique) phi[ch] = 0;

  const perms = permutations(unique);
  for (const order of perms) {
    const coalition: TrafficChannel[] = [];
    for (const ch of order) {
      const vWith = coalitionValue([...coalition, ch], conversionValue);
      const vWithout = coalitionValue(coalition, conversionValue);
      phi[ch] = (phi[ch] ?? 0) + (vWith - vWithout) / perms.length;
      coalition.push(ch);
    }
  }

  const sum = unique.reduce((s, c) => s + (phi[c] ?? 0), 0);
  const drift = conversionValue - sum;
  if (Math.abs(drift) > 0 && unique.length > 0) {
    const last = unique[unique.length - 1];
    phi[last] = (phi[last] ?? 0) + drift;
  }

  const rounded: Partial<Record<TrafficChannel, number>> = {};
  for (const c of unique) {
    rounded[c] = Math.round((phi[c] ?? 0) * 100) / 100;
  }
  return rounded;
}

export function shapleyCreditRatioForChannel(
  marginal: Partial<Record<TrafficChannel, number>>,
  channel: TrafficChannel,
  conversionValue: number
): number {
  if (conversionValue <= 0) return 0;
  const share = marginal[channel] ?? 0;
  return Math.max(0, Math.min(1, Math.round((share / conversionValue) * 1000) / 1000));
}
