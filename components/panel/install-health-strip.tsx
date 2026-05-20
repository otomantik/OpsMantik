'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { panelInstallPath } from '@/lib/auth/site-operational-route';

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

  const stateMessage =
    verified === true
      ? t('panel.installStrip.state.ready')
      : verified === false
        ? originCount > 0
          ? t('panel.installStrip.state.pending')
          : t('panel.installStrip.state.notInstalled')
        : t('panel.installStrip.state.unknown');

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      aria-label={t('panel.installStrip.title')}
    >
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">
        {t('panel.installStrip.title')}
      </h2>
      <p className="text-xs font-semibold text-slate-800">{stateMessage}</p>
      <p className="text-[10px] text-slate-500 mt-1">
        <Link href={panelInstallPath(siteId)} className="underline underline-offset-2 hover:text-slate-700">
          {t('panel.installStrip.hint')}
        </Link>
      </p>
    </section>
  );
}
