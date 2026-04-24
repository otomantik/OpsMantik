'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Site {
  id: string;
  name: string | null;
  domain: string | null;
  public_id: string;
}

interface SiteSwitcherProps {
  isAdmin?: boolean;
  currentSiteId?: string;
}

export function SiteSwitcher({ isAdmin = false, currentSiteId }: SiteSwitcherProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(currentSiteId || null);
  const router = useRouter();
  const { t } = useTranslation();

  useEffect(() => {
    const fetchSites = async () => {
      const response = await fetch('/api/sites/list', {
        method: 'GET',
        credentials: 'include',
      });
      const payloadUnknown = await response.json().catch(() => ({}));
      const payload =
        payloadUnknown && typeof payloadUnknown === 'object' && !Array.isArray(payloadUnknown)
          ? (payloadUnknown as Record<string, unknown>)
          : {};

      if (!response.ok) {
        console.error('[SITE_SWITCHER] Error fetching sites:', payload.error);
        setIsLoading(false);
        return;
      }

      const sitesData = Array.isArray(payload.sites) ? (payload.sites as Site[]) : [];
      setSites(sitesData);
      setIsLoading(false);

      // If no site selected and sites exist, select first one
      if (sitesData.length > 0) {
        setSelectedSiteId((prev) => prev ?? sitesData[0].id);
      }
    };

    fetchSites();
  }, []);

  const handleSiteSelect = (siteId: string) => {
    setSelectedSiteId(siteId);
    if (isAdmin) {
      router.push(`/api/admin/panel-preview?siteId=${encodeURIComponent(siteId)}&mode=rw`);
      return;
    }
    router.push(`/dashboard/site/${siteId}`);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('sites.yourSites')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('misc.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  if (sites.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t('sites.yourSites')}</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            {isAdmin ? t('dashboard.setup.noSitesFound') : t('dashboard.setup.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => router.push('/dashboard')}
            className="w-full"
          >
            + {t('dashboard.setup.createTestSite')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {isAdmin ? t('sites.allSites') : t('sites.yourSites')}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          {t('sites.available', { count: sites.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sites.map((site) => {
            const isSelected = selectedSiteId === site.id;
            return (
              <Button
                key={site.id}
                onClick={() => handleSiteSelect(site.id)}
                variant={isSelected ? 'default' : 'outline'}
                className="w-full justify-start"
              >
                <span className="truncate">
                  {site.name || site.domain || site.public_id}
                </span>
                {isSelected && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                )}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
