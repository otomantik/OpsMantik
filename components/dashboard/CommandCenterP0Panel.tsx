'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { createClient } from '@/lib/supabase/client';
import { useCommandCenterP0Stats } from '@/lib/hooks/use-command-center-p0-stats';

function fmt(n: number | null | undefined) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

export function CommandCenterP0Panel({ siteId }: { siteId: string }) {
  const { stats, loading, error, refetch } = useCommandCenterP0Stats(siteId);
  const [busy, setBusy] = useState<'export' | 'auto' | 'save_cpc' | null>(null);
  const [cpcDraft, setCpcDraft] = useState<string>('');

  const currency = stats?.currency || 'TRY';
  const assumedCpc = typeof stats?.assumed_cpc === 'number' ? stats.assumed_cpc : 0;

  // Keep a local editable draft (initialized lazily)
  const cpcValue = useMemo(() => {
    if (cpcDraft.trim().length > 0) return cpcDraft;
    return String(assumedCpc ?? 0);
  }, [assumedCpc, cpcDraft]);

  const runAutoApprove = async () => {
    try {
      setBusy('auto');
      const res = await fetch('/api/jobs/auto-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, minAgeHours: 24, limit: 200 }),
      });
      if (!res.ok) throw new Error('Auto-approve failed');
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  const exportOci = async () => {
    try {
      setBusy('export');
      const res = await fetch(`/api/oci/export?siteId=${encodeURIComponent(siteId)}`, {
        method: 'GET',
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opsmantik_oci_${siteId}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  const saveCpc = async () => {
    const n = Number(String(cpcValue).replace(',', '.'));
    if (Number.isNaN(n) || n < 0) return;
    try {
      setBusy('save_cpc');
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('sites')
        .update({ assumed_cpc: n })
        .eq('id', siteId);
      if (updateError) throw updateError;
      setCpcDraft('');
      await refetch();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border border-slate-200 bg-white shadow-none">
      <CardHeader className="pb-4 border-b border-slate-100 bg-slate-50/30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-lg font-bold text-slate-900">System Settings & OCI</CardTitle>
            <div className="mt-1 text-sm text-slate-500">
              Google Ads data integration and automation controls.
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="default"
              size="sm"
              className="h-9 flex-1 sm:flex-none shadow-sm"
              onClick={exportOci}
              disabled={busy !== null || loading}
            >
              {busy === 'export' ? (
                <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Icons.download className="h-4 w-4 mr-2" />
              )}
              Export OCI
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {/* 1. Financial Settings & Savings */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Icons.settings className="h-4 w-4 text-primary" />
              Costs & Savings Settings
            </h3>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500 uppercase font-bold tracking-tight">Pending in Queue</div>
                  <div className="text-xl font-bold text-slate-900">
                    {loading ? <Skeleton className="h-7 w-12" /> : fmt(stats?.queue_pending)}
                  </div>
                </div>
                <div className="space-y-1 text-right">
                  <div className="text-xs text-slate-500 uppercase font-bold tracking-tight">Est. Savings</div>
                  <div className="text-xl font-bold text-emerald-600">
                    {loading ? <Skeleton className="h-7 w-12 ml-auto" /> : `${fmt(stats?.estimated_budget_saved)} ${currency}`}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex flex-col gap-3">
                <label className="text-sm text-slate-600 font-medium leading-none">
                  Assumed Cost Per Click (CPC)
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-[200px]">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">{currency === 'TRY' ? '₺' : currency}</span>
                    <input
                      value={cpcValue}
                      onChange={(e) => setCpcDraft(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm font-semibold tabular-nums text-slate-950 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                      inputMode="decimal"
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="h-10 px-4 font-semibold"
                    onClick={saveCpc}
                    disabled={busy !== null || loading}
                  >
                    {busy === 'save_cpc' ? (
                      <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Icons.check className="h-4 w-4 mr-2 text-emerald-600" />
                    )}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Google Ads Integration (OCI) */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Icons.sparkles className="h-4 w-4 text-amber-500" />
              Google Ads Feedback (OCI)
            </h3>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Matched</div>
                  <div className="text-lg font-bold">{loading ? '…' : fmt(stats?.oci_matchable_sealed)}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Uploaded</div>
                  <div className="text-lg font-bold">{loading ? '…' : fmt(stats?.oci_uploaded)}</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Error</div>
                  <div className="text-lg font-bold text-rose-600">{loading ? '…' : fmt(stats?.oci_failed)}</div>
                </div>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed italic">
                * Data sent to Google Ads via \"Offline Conversion Import\" (OCI). Used to optimize ad performance by attributing value to actions.
              </p>
            </div>
          </section>

          {/* 3. Automation Controls */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Icons.seal className="h-4 w-4 text-emerald-500" />
              Automation Controls
            </h3>
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-slate-900">Auto-Approve (24 Hours)</div>
                  <div className="text-xs text-slate-500 max-w-[240px]">
                    System automatically seals low-risk intents if no action is taken within 24 hours.
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 bg-white"
                  onClick={runAutoApprove}
                  disabled={busy !== null || loading}
                >
                  {busy === 'auto' ? (
                    <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Icons.sparkles className="h-4 w-4 mr-2 text-amber-500" />
                  )}
                  Trigger
                </Button>
              </div>
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

