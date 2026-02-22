'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { debugLog } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Loader2, CheckCircle2, Rocket } from 'lucide-react';

export function SiteSetup() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { t } = useTranslation();

  const createTestSite = async () => {
    setIsCreating(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch('/api/create-test-site', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.details
          ? `${data.error}: ${data.details}`
          : data.error || t('dashboard.setup.createTestSiteFailed');
        console.error('[SITE_SETUP] API Error:', data);
        throw new Error(errorMessage);
      }

      setSuccess(true);
      debugLog('[SITE_SETUP] Test site created:', data.site);
      if (data.site?.public_id) {
        debugLog('[SITE_SETUP] public_id:', data.site.public_id, 'Use in test page: data-site-id="' + data.site.public_id + '"');
      }

      // Reload page after 2 seconds to refresh dashboard
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: unknown) {
      console.error('[SITE_SETUP] ❌ Error:', err);
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="border-2 border-dashed">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('dashboard.setup.noSitesFound')}</CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-2">
          {t('dashboard.setup.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="bg-muted p-4 rounded border border-border">
            <p className="text-sm text-foreground mb-2">
              <strong className="text-emerald-700">{t('dashboard.setup.testSiteDetails')}:</strong>
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
              <li>{t('dashboard.setup.publicId')} <code className="text-foreground">{t('dashboard.setup.testSiteId')}</code></li>
              {process.env.NODE_ENV === 'development' && (
                <li>{t('dashboard.setup.domain')} <code className="text-foreground">{t('dashboard.setup.testDomain')}</code></li>
              )}
              <li>{t('dashboard.setup.useThisInTracker')} <code className="text-foreground">{t('dashboard.setup.testAttr')}</code></li>
            </ul>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 p-3 rounded">
              <p className="text-sm text-destructive mb-2">{t('misc.errorLabel', { msg: error })}</p>
              <p className="text-sm text-muted-foreground">
                {t('dashboard.setup.checkConsole')}
              </p>
            </div>
          )}

          <code className="block px-2 py-1 bg-background border border-border rounded text-foreground text-sm leading-relaxed break-all">
            {`<script defer src="https://assets.yourdomain.com/assets/core.js" data-ops-site-id="test_site_123" data-ops-consent="analytics" data-api="https://console.yourdomain.com/api/sync"></script>`}
          </code>
          <p className="text-xs text-muted-foreground mt-2">
            {t('dashboard.setup.replaceDomain', { domain: 'localhost:3000', production: 'opsmantik.com' })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('dashboard.setup.ensureSiteId', { attr: 'data-site-id="test_site_123"' })}
          </p>

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded">
              <p className="text-sm text-emerald-700">{t('dashboard.setup.createdReloading')}</p>
            </div>
          )}

          <Button
            onClick={createTestSite}
            disabled={isCreating || success}
            className="w-full"
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                {t('dashboard.setup.creating')}
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                {t('dashboard.setup.created')}
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                {t('dashboard.setup.createTestSite')}
              </>
            )}
          </Button>

          <p className="text-sm text-muted-foreground text-center">
            {t('dashboard.setup.afterCreating')}{' '}
            <a href="/test-page" className="text-emerald-700 hover:text-emerald-800 underline">
              {t('dashboard.setup.testPage')}
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
