'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { panelOciPath } from '@/lib/auth/site-operational-route';
import type { OciQueueStats } from '@/lib/domain/oci/queue-types';

const POLL_MS = 45_000;

const STRIP_STATUSES = ['QUEUED', 'PROCESSING', 'UPLOADED', 'COMPLETED', 'FAILED'] as const;

export function OciStatusStrip({
  siteId,
  showManageLink,
}: {
  siteId: string;
  showManageLink: boolean;
}) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<OciQueueStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/oci/queue-stats?siteId=${encodeURIComponent(siteId)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError(t('panel.ociStrip.loadError'));
        return;
      }
      const json = (await res.json()) as OciQueueStats;
      setStats(json);
      setError(null);
    } catch {
      setError(t('panel.ociStrip.loadError'));
    }
  }, [siteId, t]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const totals = stats?.totals;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
      aria-label={t('panel.ociStrip.title')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('panel.ociStrip.title')}
        </h2>
        {showManageLink && (
          <Link
            href={panelOciPath(siteId)}
            className="text-[10px] font-black uppercase tracking-wide text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline"
          >
            {t('panel.ociStrip.manage')}
          </Link>
        )}
      </div>
      {error ? (
        <p className="text-xs text-amber-700">{error}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {STRIP_STATUSES.map((status) => {
            const n = Number(totals?.[status] ?? 0);
            return (
              <span
                key={status}
                className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700"
              >
                <span className="text-slate-400">{t(`panel.ociStrip.status.${status}`)}</span>
                <span>{n}</span>
              </span>
            );
          })}
        </div>
      )}
      {stats?.stuck_processing_count != null && stats.stuck_processing_count > 0 && (
        <p className="mt-2 text-[10px] font-bold text-amber-800">
          {t('panel.ociStrip.stuck', { count: stats.stuck_processing_count })}
        </p>
      )}
    </section>
  );
}
