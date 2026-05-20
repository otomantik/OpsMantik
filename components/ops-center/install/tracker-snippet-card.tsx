'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/useTranslation';

export function TrackerSnippetCard({
  siteId,
  sitePublicId,
}: {
  siteId: string;
  sitePublicId: string;
}) {
  const { t } = useTranslation();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/tracker-embed?mode=proxy`,
        { credentials: 'include' }
      );
      const json = (await res.json()) as {
        proxyScriptTag?: string;
        scriptTag?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? t('panel.install.trackerSnippet.loadError'));
        setSnippet(null);
        return;
      }
      const tag = json.proxyScriptTag ?? json.scriptTag ?? null;
      if (!tag || tag.includes('data-ops-secret')) {
        setError(t('panel.install.trackerSnippet.loadError'));
        setSnippet(null);
        return;
      }
      setSnippet(tag);
    } catch {
      setError(t('panel.install.trackerSnippet.loadError'));
      setSnippet(null);
    } finally {
      setLoading(false);
    }
  }, [siteId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCopy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
        {t('panel.install.trackerSnippet.title')}
      </h2>
      <p className="text-xs text-slate-600 mb-3">{t('panel.install.trackerSnippet.subtitle')}</p>
      <p className="text-[10px] font-bold text-slate-500 mb-2">
        {t('panel.install.trackerSnippet.siteIdLabel')}:{' '}
        <span className="font-mono text-slate-800">{sitePublicId}</span>
      </p>
      {loading ? (
        <LoadingRow label={t('panel.install.trackerSnippet.loading')} />
      ) : error ? (
        <p className="text-xs text-amber-700">{error}</p>
      ) : (
        <>
          <code className="block w-full overflow-x-auto rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-800 break-all">
            {snippet}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void onCopy()} disabled={!snippet}>
              <Copy className="h-3.5 w-3.5 mr-1" />
              {copied ? t('panel.install.trackerSnippet.copied') : t('panel.install.trackerSnippet.copy')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void load()}>
              {t('panel.install.trackerSnippet.refresh')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}
