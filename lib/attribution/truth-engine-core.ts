/**
 * Source Truth Engine v2 — pure 4D classifier (zero I/O).
 */

import type { PreviousSessionContext, TrafficClassificationV2 } from './truth-engine-types';
import { createClassificationContext } from './pipeline/context';
import { assembleVerdict } from './pipeline/verdict-assembler';
import { evaluateShoppingTrap } from './pipeline/evaluators/02-shopping-trap';
import { evaluateFraud } from './pipeline/evaluators/01-fraud-evaluator';
import { evaluateClickId } from './pipeline/evaluators/03-click-id-evaluator';
import { evaluateUtm } from './pipeline/evaluators/04-utm-evaluator';
import { evaluateUaWhisper } from './pipeline/evaluators/05-ua-whisper-evaluator';
import { evaluateTemporal } from './pipeline/evaluators/06-temporal-evaluator';
import { evaluateReferrer } from './pipeline/evaluators/07-referrer-evaluator';
import { evaluateFallback } from './pipeline/evaluators/08-fallback-evaluator';
import { pushTrace } from './pipeline/trace';

export type { PreviousSessionContext, TrafficClassificationV2 } from './truth-engine-types';

export function classifyTraffic(
  url: string,
  referrer: string,
  userAgent: string,
  previousSession?: PreviousSessionContext
): TrafficClassificationV2 {
  const ctx = createClassificationContext(url, referrer, userAgent, previousSession);
  pushTrace(ctx, 'EVIDENCE_EVAL', 'parsed URL params');

  evaluateShoppingTrap(ctx);
  evaluateFraud(ctx);
  evaluateClickId(ctx);
  if (!ctx.terminal) evaluateUtm(ctx);
  if (!ctx.terminal) evaluateUaWhisper(ctx);
  if (!ctx.terminal) evaluateTemporal(ctx);
  if (!ctx.terminal) evaluateReferrer(ctx);
  if (!ctx.terminal) evaluateFallback(ctx);

  return assembleVerdict(ctx);
}
