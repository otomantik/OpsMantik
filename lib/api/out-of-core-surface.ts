import { NextResponse } from 'next/server';
import { isProductionDeployment } from '@/lib/env/is-production-deployment';

/** Out-of-core API surfaces retired from production (CUT ladder: PROD_OFF 410 → observe → delete later). */
export const OUT_OF_CORE_SURFACES = {
  google_spend_webhook: 'google_spend_webhook',
  google_spend_dashboard: 'google_spend_dashboard',
  stats_realtime: 'stats_realtime',
  reporting_dashboard_stats: 'reporting_dashboard_stats',
  conversations_collection: 'conversations_collection',
  conversations_detail: 'conversations_detail',
  conversations_assign: 'conversations_assign',
  conversations_follow_up: 'conversations_follow_up',
  conversations_link: 'conversations_link',
  conversations_note: 'conversations_note',
  conversations_reopen: 'conversations_reopen',
  conversations_resolve: 'conversations_resolve',
  conversations_stage: 'conversations_stage',
} as const;

export type OutOfCoreSurface = (typeof OUT_OF_CORE_SURFACES)[keyof typeof OUT_OF_CORE_SURFACES];

export function isOutOfCoreSurfaceRetiredInProduction(): boolean {
  return isProductionDeployment();
}

/** When `1`, block retired surfaces in non-production (CI / local strict checks). */
export function isOutOfCoreSurfaceStrictMode(): boolean {
  return process.env.OUT_OF_CORE_SURFACES_STRICT === '1';
}

export function shouldBlockOutOfCoreSurface(): boolean {
  return isOutOfCoreSurfaceRetiredInProduction() || isOutOfCoreSurfaceStrictMode();
}

export function outOfCoreSurfaceGoneResponse(surface: OutOfCoreSurface): NextResponse {
  return NextResponse.json(
    { error: 'gone', code: 'SURFACE_RETIRED', surface },
    { status: 410 },
  );
}

/** Returns a 410 response when the surface is retired; otherwise null (caller continues). */
export function assertOutOfCoreSurfaceAllowed(surface: OutOfCoreSurface): NextResponse | null {
  if (shouldBlockOutOfCoreSurface()) {
    return outOfCoreSurfaceGoneResponse(surface);
  }
  return null;
}
