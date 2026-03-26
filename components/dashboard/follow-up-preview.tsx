'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { getLocalizedLabel } from '@/lib/i18n/mapping';

type PreviewItem = {
  id: string;
  assigned_to: string | null;
  phone_e164: string | null;
  customer_hash: string | null;
  next_follow_up_at: string | null;
  last_note_preview: string | null;
  mizan_predicted_value: number | null;
  source_summary?: Record<string, unknown> | null;
};

type PreviewResponse = {
  items: PreviewItem[];
};

async function readJson<T>(input: RequestInfo, init?: RequestInit, fallbackError = 'İstek başarısız oldu'): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : fallbackError);
  }
  return body as T;
}

function previewTone(item: PreviewItem) {
  if (!item.assigned_to) return 'border-amber-300 bg-amber-50 text-amber-700';
  if (!item.next_follow_up_at) return 'border-slate-300 bg-slate-50 text-slate-700';
  if (new Date(item.next_follow_up_at).getTime() < Date.now()) return 'border-rose-300 bg-rose-50 text-rose-700';
  return 'border-sky-300 bg-sky-50 text-sky-700';
}

function previewLabel(item: PreviewItem, t: (key: any) => string) {
  if (!item.assigned_to) return t('crm.preview.unassigned');
  if (!item.next_follow_up_at) return t('crm.preview.today');
  if (new Date(item.next_follow_up_at).getTime() < Date.now()) return t('crm.preview.overdue');
  return t('crm.preview.today');
}

function previewSummary(
  item: PreviewItem,
  fallback: string,
  t: (key: import('@/lib/i18n/t').TranslationKey, params?: Record<string, string | number>) => string
) {
  const intentAction = typeof item.source_summary?.intent_action === 'string' ? item.source_summary.intent_action : null;
  const source = typeof item.source_summary?.source === 'string' ? item.source_summary.source : null;
  return item.last_note_preview || (intentAction ? getLocalizedLabel(intentAction, t) : null) || (source ? getLocalizedLabel(source, t) : null) || fallback;
}

export function FollowUpPreview({ siteId }: { siteId: string }) {
  const { t, formatTimestamp, formatNumber } = useTranslation();
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const overdue = await readJson<PreviewResponse>(`/api/conversations?site_id=${siteId}&bucket=overdue&limit=3`, {
          signal: controller.signal,
        }, t('crm.error.requestFailed'));
        const today = await readJson<PreviewResponse>(`/api/conversations?site_id=${siteId}&bucket=today&limit=3`, {
          signal: controller.signal,
        }, t('crm.error.requestFailed'));
        const merged = [...(overdue.items ?? []), ...(today.items ?? [])];
        const unique = merged.filter((item, index, arr) => arr.findIndex((row) => row.id === item.id) === index).slice(0, 4);
        if (!cancelled) setItems(unique);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('crm.error.requestFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [siteId, t]);

  const content = useMemo(() => {
    if (loading) {
      return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">{t('crm.state.loadingConversations')}</div>;
    }
    if (error) {
      return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>;
    }
    if (items.length === 0) {
      return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">{t('crm.preview.empty')}</div>;
    }
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-slate-900">
                  {item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-slate-500">
                  {previewSummary(item, t('crm.state.noNote'), t)}
                </div>
              </div>
              <Badge variant="outline" className={previewTone(item)}>
                {previewLabel(item, t)}
              </Badge>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('crm.preview.nextStep')}</div>
                  <div>{item.next_follow_up_at ? formatTimestamp(item.next_follow_up_at) : '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{t('crm.preview.valueLabel')}</div>
                  <div className="font-semibold text-slate-900">{formatNumber(item.mizan_predicted_value ?? 0)}</div>
                </div>
              </div>
              <Link href={`/dashboard/site/${siteId}/conversations`}>
                <Button size="sm" className="w-full sm:w-auto">{t('crm.preview.viewAll')}</Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    );
  }, [error, formatNumber, formatTimestamp, items, loading, siteId, t]);

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg text-slate-900">{t('dashboard.followUpPreview')}</CardTitle>
        <CardDescription>{t('dashboard.followUpPreviewSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {content}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`/dashboard/site/${siteId}/conversations`} className="w-full sm:w-auto">
            <Button variant="outline" className="w-full sm:w-auto">{t('dashboard.openFollowUps')}</Button>
          </Link>
          <Link href={`/dashboard/site/${siteId}/today-desk`} className="w-full sm:w-auto">
            <Button variant="outline" className="w-full sm:w-auto">{t('dashboard.openTodayWork')}</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
