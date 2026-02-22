'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
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
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      // Admin sees all sites, normal users see only their sites (RLS enforces)
      // RLS policy allows: owner OR member OR admin
      // So we can query all sites and RLS will filter appropriately
      const { data: sitesData, error } = await supabase
        .from('sites')
        .select('id, name, domain, public_id')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[SITE_SWITCHER] Error fetching sites:', error);
        setIsLoading(false);
        return;
      }

      setSites(sitesData || []);
      setIsLoading(false);

      // If no site selected and sites exist, select first one
      if (!selectedSiteId && sitesData && sitesData.length > 0) {
        setSelectedSiteId(sitesData[0].id);
      }
    };

    fetchSites();
  }, [selectedSiteId]);

  const handleSiteSelect = (siteId: string) => {
    setSelectedSiteId(siteId);
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
            {isAdmin ? t('setup.noSitesFound') : t('setup.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => router.push('/dashboard')}
            className="w-full"
          >
            + {t('setup.createTestSite')}
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
                  <span className="ml-auto text-emerald-600">✓</span>
                )}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
