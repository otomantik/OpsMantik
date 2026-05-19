'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type OriginRow = {
  origin: string;
  status?: string | null;
  verification_state?: string | null;
};

export function InstallHealthStrip({ siteId }: { siteId: string }) {
  const { t } = useTranslation();
  const [verified, setVerified] = useState<boolean | null>(null);
  const [originCount, setOriginCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${encodeURIComponent(siteId)}/origins`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setVerified(null);
        return;
      }
      const json = (await res.json()) as { origins?: OriginRow[] };
      const rows = json.origins ?? [];
      setOriginCount(rows.length);
      setVerified(
        rows.some(
          (r) =>
            String(r.verification_state || '').toLowerCase() === 'verified' ||
            String(r.status || '').toLowerCase() === 'active'
        )
      );
    } catch {
      setVerified(null);
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stateKey =
    verified === true
      ? 'ready'
      : verified === false
        ? originCount > 0
          ? 'pending'
          : 'notInstalled'
        : 'unknown';

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      aria-label={t('panel.installStrip.title')}
    >
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">
        {t('panel.installStrip.title')}
      </h2>
      <p className="text-xs font-semibold text-slate-800">{t(`panel.installStrip.state.${stateKey}`)}</p>
      <p className="text-[10px] text-slate-500 mt-1">{t('panel.installStrip.hint')}</p>
    </section>
  );
}
