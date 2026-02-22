'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { debugLog } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { IngestMeta } from '@/lib/types/ingest';
import { useTranslation } from '@/lib/i18n/useTranslation';

declare global {
  interface Window {
    opmantik?: {
      send: (category: string, action: string, label?: string, value?: number, metadata?: IngestMeta) => void;
      session: () => { sessionId: string; fingerprint: string; context: string };
    };
  }
}

export default function TestPage() {
  const { t } = useTranslation();
  const [trackerLoaded, setTrackerLoaded] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string; fingerprint: string; gclid: string } | null>(null);
  const [eventLog, setEventLog] = useState<Array<{ time: string; event: string; status: string }>>([]);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const [apiStatus, setApiStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [siteId, setSiteId] = useState<string>('test_site_123'); // Default fallback
  const [eventTriggerStatus, setEventTriggerStatus] = useState<Record<string, { triggered: boolean; time: string }>>({});

  // Google Ads Test state
  const [gclid, setGclid] = useState<string>('EAIaIQobChMI...');
  const [utmSource, setUtmSource] = useState<string>('google');
  const [utmCampaign, setUtmCampaign] = useState<string>('test_campaign');
  const [deviceOverride, setDeviceOverride] = useState<string>('desktop');

  // Fetch user's site ID
  useEffect(() => {
    const fetchUserSite = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: sites } = await supabase
        .from('sites')
        .select('public_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();

      if (sites?.public_id) {
        setSiteId(sites.public_id);
        debugLog('[TEST_PAGE] Using site ID:', sites.public_id);
      }
    };

    fetchUserSite();
  }, []);

  // Load tracker script - ONLY ONCE (after siteId is loaded)
  useEffect(() => {
    if (!siteId) return; // Wait for siteId

    // Check if tracker already exists
    if (window.opmantik) {
      debugLog('[TEST_PAGE] Tracker already loaded');
      setTrackerLoaded(true);
      updateSessionInfo();
      return;
    }

    // Check if script already exists in DOM
    const existingScript = document.querySelector(`script[data-site-id="${siteId}"]`);
    if (existingScript) {
      debugLog('[TEST_PAGE] Script already in DOM, waiting...');
      const checkInterval = setInterval(() => {
        if (window.opmantik) {
          setTrackerLoaded(true);
          updateSessionInfo();
          clearInterval(checkInterval);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }

    // Create and load script with cache busting
    const script = document.createElement('script');
    const timestamp = Date.now();
    script.src = `/ux-core.js?v=${timestamp}`;
    script.setAttribute('data-site-id', siteId);
    script.setAttribute('id', 'opmantik-tracker-script');

    script.onload = () => {
      debugLog('[TEST_PAGE] Tracker script loaded');
      setTimeout(() => {
        if (window.opmantik) {
          setTrackerLoaded(true);
          updateSessionInfo();
        } else {
          console.error('[TEST_PAGE] ❌ Tracker API not available after load');
        }
      }, 300);
    };

    script.onerror = () => {
      console.error('[TEST_PAGE] ❌ Failed to load tracker script');
      setTrackerLoaded(false);
    };

    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      // Don't remove script on unmount - let it stay for page navigation
    };
  }, [siteId]);

  const updateSessionInfo = () => {
    if (window.opmantik) {
      try {
        const session = window.opmantik.session();
        setSessionInfo({
          sessionId: session.sessionId,
          fingerprint: session.fingerprint,
          gclid: session.context || 'None',
        });
      } catch (e) {
        console.error('[TEST_PAGE] Error getting session:', e);
      }
    }
  };

  const clearStorage = () => {
    sessionStorage.removeItem('opmantik_session_sid');
    sessionStorage.removeItem('opmantik_session_context');
    localStorage.removeItem('opmantik_session_fp');
    debugLog('[TEST_PAGE] Storage cleared');
    alert(t('test.page.storageCleared'));
    window.location.reload();
  };

  const sendEvent = (category: string, action: string, label?: string, value?: number, metadata?: IngestMeta) => {
    if (!window.opmantik) {
      console.error('[TEST_PAGE] ❌ Tracker not loaded');
      alert(t('test.page.trackerNotLoaded'));
      return;
    }

    setApiStatus('sending');
    const time = new Date().toLocaleTimeString('tr-TR');
    const eventKey = `${category}:${action}${label ? `:${label}` : ''}`;

    // Mark event as triggered
    setEventTriggerStatus(prev => ({
      ...prev,
      [eventKey]: { triggered: true, time }
    }));

    try {
      // Send event via tracker with metadata
      window.opmantik.send(category, action, label, value, metadata);

      // Add to event log immediately (tracker handles API call asynchronously)
      setEventLog(prev => [{
        time,
        event: `${category}:${action}${label ? ` (${label})` : ''}`,
        status: '✅'
      }, ...prev].slice(0, 30));

      setApiStatus('success');
      debugLog('[TEST_PAGE] Event triggered:', { category, action, label, value, metadata });

      setTimeout(() => setApiStatus('idle'), 2000);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setApiStatus('error');
      setEventLog(prev => [{
        time,
        event: `${category}:${action} - ERROR: ${msg || 'Unknown'}`,
        status: '❌'
      }, ...prev].slice(0, 30));
      console.error('[TEST_PAGE] ❌ Event send error:', error);
      setTimeout(() => setApiStatus('idle'), 2000);
    }
  };

  const simulatePaidClick = async () => {
    if (!gclid || !gclid.trim()) {
      alert(t('test.page.gclid.label') + ' required!');
      return;
    }

    // Store GCLID in sessionStorage so tracker picks it up
    sessionStorage.setItem('opmantik_session_context', gclid);
    debugLog('[TEST_PAGE] GCLID stored in sessionStorage:', gclid);

    // Build URL with GCLID and UTM params
    const url = new URL(window.location.href);
    url.searchParams.set('gclid', gclid);
    if (utmSource) url.searchParams.set('utm_source', utmSource);
    if (utmCampaign) url.searchParams.set('utm_campaign', utmCampaign);

    // Update URL without reload (for testing)
    window.history.replaceState({}, '', url.toString());
    debugLog('[TEST_PAGE] URL updated with GCLID:', url.toString());

    // Verify URL was updated
    const currentUrl = new URL(window.location.href);
    const urlGclid = currentUrl.searchParams.get('gclid');
    debugLog('[TEST_PAGE] Current URL GCLID:', urlGclid);

    // Force tracker to re-read context by triggering a new session check
    // The tracker reads from URL params first, then sessionStorage
    if (window.opmantik?.session) {
      // Get fresh session with updated context
      const session = window.opmantik.session();
      debugLog('[TEST_PAGE] Session context:', session.context);
    }

    // Send event with GCLID in metadata (explicit override - this takes precedence)
    debugLog('[TEST_PAGE] Sending paid_click event with GCLID:', gclid);
    sendEvent('acquisition', 'paid_click', 'google_ads_test', undefined, {
      gclid: gclid, // Explicit override in metadata
      utm_source: utmSource || undefined,
      utm_campaign: utmCampaign || undefined,
      device_type: deviceOverride,
    });

    // Also send a page view to create session (with GCLID in URL)
    setTimeout(() => {
      debugLog('[TEST_PAGE] Sending page view event');
      sendEvent('interaction', 'view', 'test_page_paid');
    }, 500);
  };

  const simulateConversion = () => {
    // Send conversion event (form_submit or phone_call)
    sendEvent('conversion', 'form_submit', 'google_ads_lead', undefined, {
      gclid: gclid || undefined,
      utm_source: utmSource || undefined,
      utm_campaign: utmCampaign || undefined,
    });
  };

  // Attribution scenario buttons (new scenarios for source/context testing)
  const simulatePaidClickScenario = () => {
    // Set GCLID in URL and metadata
    const url = new URL(window.location.href);
    url.searchParams.set('gclid', 'EAIaIQobChMI_test_paid_click');
    url.searchParams.set('utm_medium', 'cpc');
    url.searchParams.set('utm_source', 'google');
    window.history.replaceState({}, '', url.toString());

    sendEvent('acquisition', 'paid_click', 'test_paid_scenario', undefined, {
      gclid: 'EAIaIQobChMI_test_paid_click',
      utm_medium: 'cpc',
      utm_source: 'google',
    });

    addToEventLog('Paid Click (GCLID + UTM)', '✅');
  };

  const simulatePaidSocialScenario = () => {
    // Simulate Facebook referrer
    sendEvent('acquisition', 'social_click', 'test_social_scenario', undefined, {
      ref: 'https://www.facebook.com/test',
      utm_source: 'facebook',
    });

    // Note: Referrer is sent in payload, but we can't set document.referrer
    // The server will see it from the request
    addToEventLog('Paid Social (Facebook referrer)', '✅');
  };

  const simulateOrganicScenario = () => {
    // Clear GCLID and UTM, empty referrer
    const url = new URL(window.location.href);
    url.searchParams.delete('gclid');
    url.searchParams.delete('utm_medium');
    url.searchParams.delete('utm_source');
    window.history.replaceState({}, '', url.toString());

    sendEvent('interaction', 'organic_visit', 'test_organic_scenario', undefined, {
      // No gclid, no utm
    });

    addToEventLog('Organic (no GCLID/UTM)', '✅');
  };

  const simulateGeoOverrideScenario = () => {
    // Send event with city/district override in metadata
    sendEvent('interaction', 'geo_test', 'test_geo_override', undefined, {
      city: 'Istanbul',
      district: 'Kadikoy',
      device_type: 'mobile',
    });

    addToEventLog('Geo Override (Istanbul, Kadikoy)', '✅');
  };

  const addToEventLog = (event: string, status: string) => {
    setEventLog(prev => [{
      time: new Date().toLocaleTimeString(),
      event,
      status
    }, ...prev].slice(0, 10));
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{t('test.page.title')}</h1>
            <p className="text-muted-foreground text-sm">
              {t('test.page.subtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button variant="outline">
                📊 {t('common.dashboard')}
              </Button>
            </Link>
            <Button
              onClick={clearStorage}
              variant="outline"
              className="text-destructive border-destructive/20 hover:bg-destructive/10"
            >
              🗑️ {t('test.page.clearStorage')}
            </Button>
          </div>
        </div>

        {/* Status Card */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">{t('test.page.status.title')}</CardTitle>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${trackerLoaded ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}></div>
                <span className={`text-xs ${trackerLoaded ? 'text-emerald-700' : 'text-destructive'}`}>
                  {trackerLoaded ? t('test.page.status.active') : t('test.page.status.inactive')}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('test.page.label.tracker')}</p>
                <p className={`text-sm font-semibold ${trackerLoaded ? 'text-emerald-700' : 'text-destructive'}`}>
                  {trackerLoaded ? t('test.page.status.loaded') : t('test.page.status.notLoaded')}
                </p>
              </div>
              {sessionInfo ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t('test.page.label.sessionId')}</p>
                    <p className="text-xs text-foreground truncate tabular-nums" title={sessionInfo.sessionId}>
                      {sessionInfo.sessionId.slice(0, 20)}...
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t('test.page.label.fingerprint')}</p>
                    <p className="text-xs text-foreground truncate tabular-nums" title={sessionInfo.fingerprint}>
                      {sessionInfo.fingerprint}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t('test.page.label.gclid')}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {sessionInfo.gclid !== 'None' ? sessionInfo.gclid.slice(0, 15) + '...' : t('common.na')}
                    </p>
                  </div>
                </>
              ) : (
                <div className="col-span-3">
                  <p className="text-xs text-muted-foreground">{t('test.page.session.loading')}</p>
                </div>
              )}
            </div>
            <div className="pt-3 border-t border-border">
              <div className="flex items-center gap-4">
                <Button
                  onClick={updateSessionInfo}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  🔄 {t('test.page.refreshSession')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('test.page.label.apiStatus')}{' '}
                  <span className={apiStatus === 'success' ? 'text-emerald-700' : apiStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                    {apiStatus}
                  </span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attribution Scenarios */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">{t('test.page.attribution.title')}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              {t('test.page.attribution.desc', { siteId: siteId || '...' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Button
                onClick={simulatePaidClickScenario}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-sm"
                disabled={!trackerLoaded}
              >
                💰 {t('test.page.simulate.paidClick')}
              </Button>
              <Button
                onClick={simulatePaidSocialScenario}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-sm"
                disabled={!trackerLoaded}
              >
                📱 {t('test.page.simulate.paidSocial')}
              </Button>
              <Button
                onClick={simulateOrganicScenario}
                size="sm"
                variant="secondary"
                className="text-sm"
                disabled={!trackerLoaded}
              >
                🌱 {t('test.page.simulate.organic')}
              </Button>
              <Button
                onClick={simulateGeoOverrideScenario}
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-sm"
                disabled={!trackerLoaded}
              >
                📍 {t('test.page.simulate.geo')}
              </Button>
            </div>
            {eventLog.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-sm text-muted-foreground mb-2">{t('test.page.recentScenarios')}</p>
                <div className="space-y-1">
                  {eventLog.map((log, idx) => (
                    <div key={idx} className="text-sm text-foreground">
                      <span className="text-muted-foreground tabular-nums">{log.time}</span> - {log.event} ({log.status})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Event Trigger Status */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">{t('test.page.triggerStatus.title')}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              {t('test.page.triggerStatus.desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { key: 'conversion:cta_click:quick_test', label: 'CTA Click' },
                { key: 'conversion:form_submit:quick_test', label: 'Form Submit' },
                { key: 'interaction:page_visit:test_page', label: 'Page Visit' },
                { key: 'conversion:download:test.pdf', label: 'Download' },
                { key: 'interaction:video_watch:test_video', label: 'Video Watch' },
              ].map(({ key, label }) => {
                const status = eventTriggerStatus[key];
                return (
                  <div
                    key={key}
                    className={`p-2 rounded border text-center transition-all ${status?.triggered
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-muted border-border text-muted-foreground'
                      }`}
                  >
                    <p className="text-sm font-semibold">{label}</p>
                    {status?.triggered && (
                      <p className="text-sm text-emerald-800 mt-1 tabular-nums">{status.time}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Event Log */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">{t('test.page.eventLog.title')}</CardTitle>
                <CardDescription className="text-sm text-muted-foreground mt-1">
                  {t('test.page.eventLog.desc', { count: eventLog.length })}
                </CardDescription>
              </div>
              {eventLog.length > 0 && (
                <Button
                  onClick={() => {
                    setEventLog([]);
                    setEventTriggerStatus({});
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-sm"
                >
                  {t('common.close')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {eventLog.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">{t('test.page.eventLog.empty')}</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {eventLog.map((log, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm py-1 border-b border-border">
                    <span className="text-muted-foreground w-20 tabular-nums">{log.time}</span>
                    <span className={log.status === '✅' ? 'text-emerald-700' : 'text-destructive'}>{log.status}</span>
                    <span className="text-foreground flex-1">{log.event}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Test Buttons */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Button
            onClick={() => sendEvent('conversion', 'cta_click', 'quick_test')}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-sm"
            disabled={!trackerLoaded}
          >
            ✅ {t('test.page.events.cta')}
          </Button>
          <Button
            onClick={() => sendEvent('conversion', 'form_submit', 'quick_test')}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-sm"
            disabled={!trackerLoaded}
          >
            📝 {t('test.page.events.formSubmit')}
          </Button>
          <Button
            onClick={() => sendEvent('interaction', 'page_visit', 'test_page')}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700 text-sm"
            disabled={!trackerLoaded}
          >
            👁️ {t('test.page.events.newsletter')}
          </Button>
          <Button
            onClick={() => sendEvent('conversion', 'download', 'test.pdf')}
            size="sm"
            className="bg-rose-600 hover:bg-rose-700 text-sm"
            disabled={!trackerLoaded}
          >
            📥 {t('test.page.events.download')}
          </Button>
          <Button
            onClick={() => sendEvent('interaction', 'video_watch', 'test_video', 30)}
            size="sm"
            className="bg-yellow-600 hover:bg-yellow-700 text-sm"
            disabled={!trackerLoaded}
          >
            🎥 {t('test.page.events.videoWatch')}
          </Button>
        </div>

        {/* Google Ads Test Module */}
        <Card className="mb-6 border-2 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">{t('test.page.gclid.title')}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-1">
              {t('test.page.gclid.desc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="gclid" className="text-sm text-muted-foreground mb-2 block">
                  {t('test.page.gclid.label')}
                </label>
                <input
                  id="gclid"
                  type="text"
                  value={gclid}
                  onChange={(e) => setGclid(e.target.value)}
                  placeholder={t('test.page.gclid.label')}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="device" className="text-sm text-muted-foreground mb-2 block">
                  {t('test.page.device.label')}
                </label>
                <select
                  id="device"
                  value={deviceOverride}
                  onChange={(e) => setDeviceOverride(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="desktop">{t('device.desktop')}</option>
                  <option value="mobile">{t('device.mobile')}</option>
                  <option value="tablet">{t('device.tablet')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="utm_source" className="text-sm text-muted-foreground mb-2 block">
                  {t('test.page.utmSource.label')}
                </label>
                <input
                  id="utm_source"
                  type="text"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder={t('test.page.utmSource.placeholder')}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label htmlFor="utm_campaign" className="text-sm text-muted-foreground mb-2 block">
                  {t('test.page.utmCampaign.label')}
                </label>
                <input
                  id="utm_campaign"
                  type="text"
                  value={utmCampaign}
                  onChange={(e) => setUtmCampaign(e.target.value)}
                  placeholder={t('test.page.utmCampaign.placeholder')}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={simulatePaidClick}
                className="bg-blue-600 hover:bg-blue-700 text-sm flex-1"
                disabled={!trackerLoaded || !gclid.trim()}
              >
                🎯 {t('test.page.simulate.paidClick')}
              </Button>
              <Button
                onClick={simulateConversion}
                className="bg-emerald-600 hover:bg-emerald-700 text-sm flex-1"
                disabled={!trackerLoaded}
              >
                ✅ {t('test.page.simulate.conversion')}
              </Button>
            </div>
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground">
                💡 <strong>{t('test.page.tip.title')}</strong> {t('test.page.tip.body', { source: 'SOURCE: First Click (Paid)', gclid: 'GCLID' })}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Detailed Test Events */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Phone Call */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">📞 {t('test.page.events.phone')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.phone')}</CardDescription>
            </CardHeader>
            <CardContent>
              <a href="tel:+905551234567" className="text-blue-700 hover:text-blue-800 text-sm block mb-2">
                +90 555 123 45 67
              </a>
              <p className="text-sm text-muted-foreground">{t('test.page.instruction.clickPhone')}</p>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">💬 {t('test.page.events.whatsapp')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.whatsapp')}</CardDescription>
            </CardHeader>
            <CardContent>
              <a href="https://wa.me/905551234567" target="_blank" className="text-emerald-700 hover:text-emerald-800 text-sm block mb-2">
                {t('test.page.events.whatsappContact')}
              </a>
              <p className="text-sm text-muted-foreground">{t('test.page.instruction.clickWhatsapp')}</p>
            </CardContent>
          </Card>

          {/* Form Submit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">📋 {t('test.page.events.formSubmit')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.formSubmit')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendEvent('conversion', 'form_submit', 'lead_form');
                }}
              >
                <input
                  type="email"
                  placeholder={t('common.email')}
                  className="w-full px-3 py-2 border border-border bg-background rounded mb-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={!trackerLoaded}>
                  {t('test.page.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* CTA Button */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">🎯 {t('test.page.events.cta')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.cta')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => sendEvent('conversion', 'cta_click', 'pricing_cta')}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!trackerLoaded}
              >
                {t('test.page.startNow')}
              </Button>
            </CardContent>
          </Card>

          {/* Download */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">📥 {t('test.page.events.download')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.download')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => sendEvent('conversion', 'download', 'brochure.pdf')}
                className="w-full bg-purple-600 hover:bg-purple-700"
                disabled={!trackerLoaded}
              >
                {t('test.page.downloadBrochure')}
              </Button>
            </CardContent>
          </Card>

          {/* Pricing Hover */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">🖱️ {t('test.page.events.pricingHover')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">2 {t('common.unit.second.short')} {t('common.hover')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="p-4 border border-border rounded cursor-pointer hover:border-emerald-300 transition-colors"
                onMouseEnter={() => {
                  setTimeout(() => {
                    sendEvent('interaction', 'hover_intent', 'pricing_card', 2);
                  }, 2000);
                }}
              >
                <p className="text-foreground text-sm">{t('test.page.hoverMe')}</p>
              </div>
            </CardContent>
          </Card>

          {/* Video Watch */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">🎥 {t('test.page.events.videoWatch')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.videoWatch')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => sendEvent('interaction', 'video_watch', 'intro_video', 30)}
                className="w-full bg-rose-600 hover:bg-rose-700"
                disabled={!trackerLoaded}
              >
                {t('test.page.watchVideo')}
              </Button>
            </CardContent>
          </Card>

          {/* Newsletter Signup */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">📧 {t('test.page.events.newsletter')}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">{t('test.page.events.newsletter')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendEvent('conversion', 'newsletter_signup', 'footer_form');
                }}
              >
                <input
                  type="email"
                  placeholder={t('common.email')}
                  className="w-full px-3 py-2 border border-border bg-background rounded mb-2 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={!trackerLoaded}>
                  {t('test.page.subscribe')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
