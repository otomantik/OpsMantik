import { adminClient } from '@/lib/supabase/admin';
import type { InstallHealthInput } from '@/lib/panel/install-status';

export type InstallSiteSnapshot = InstallHealthInput & {
  siteName: string;
  sitePublicId: string;
  siteDomain: string | null;
  siteLocale: string | null;
  siteTimezone: string | null;
  siteCurrency: string | null;
};

const TRACKER_SCRIPT_VERSION = '7';

/**
 * Read-only site health for Install Center (no secret material).
 */
export async function loadInstallSiteSnapshot(siteId: string): Promise<InstallSiteSnapshot | null> {
  const { data: site, error: siteErr } = await adminClient
    .from('sites')
    .select('id, name, public_id, domain, locale, timezone, currency')
    .eq('id', siteId)
    .maybeSingle();

  if (siteErr || !site?.public_id) {
    return null;
  }

  const { data: origins } = await adminClient
    .from('site_allowed_origins')
    .select('verification_state, status')
    .eq('site_id', siteId);

  const originRows = origins ?? [];
  const originCount = originRows.length;
  const originVerified =
    originCount === 0
      ? null
      : originRows.some(
          (r) =>
            String(r.verification_state || '').toLowerCase() === 'verified' ||
            String(r.status || '').toLowerCase() === 'active'
        );

  const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
  const { data: sessions } = await adminClient
    .from('sessions')
    .select('id')
    .eq('site_id', siteId)
    .eq('created_month', currentMonth)
    .limit(100);

  let lastEventAt: string | null = null;
  let lastEventAction: string | null = null;
  let lastHeartbeatAt: string | null = null;

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    const { data: event } = await adminClient
      .from('events')
      .select('created_at, event_action, event_category')
      .in('session_id', sessionIds)
      .eq('session_month', currentMonth)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (event?.created_at) {
      lastEventAt = event.created_at;
      lastEventAction = event.event_action ?? null;
      if (event.event_action === 'heartbeat' || event.event_category === 'system') {
        lastHeartbeatAt = event.created_at;
      }
    }
  }

  let trafficReceiving: boolean | null = null;
  if (lastEventAt) {
    const minutesAgo = (Date.now() - new Date(lastEventAt).getTime()) / (1000 * 60);
    trafficReceiving = minutesAgo <= 10;
  } else if (originCount > 0) {
    trafficReceiving = false;
  }

  const { data: intentRow } = await adminClient
    .from('calls')
    .select('id')
    .eq('site_id', siteId)
    .eq('status', 'intent')
    .limit(1)
    .maybeSingle();

  return {
    siteName: site.name || 'OpsMantik',
    sitePublicId: site.public_id,
    siteDomain: site.domain ?? null,
    siteLocale: site.locale ?? null,
    siteTimezone: site.timezone ?? null,
    siteCurrency: site.currency ?? null,
    originCount,
    originVerified,
    lastEventAt,
    lastEventAction,
    lastHeartbeatAt,
    trafficReceiving,
    hasIntentCalls: Boolean(intentRow?.id),
    scriptVersion: TRACKER_SCRIPT_VERSION,
    liveScriptVersion: null,
    consentAnalyticsPresent: null,
  };
}
