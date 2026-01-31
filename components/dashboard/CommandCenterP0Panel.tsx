'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold">Command Center P0</CardTitle>
            <div className="mt-1 text-sm text-slate-500">
              OCI feedback loop • High-Risk explainability • Auto-approve safety valve
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={runAutoApprove}
              disabled={busy !== null || loading}
              title="Auto-approve stale low-risk intents (24h)"
            >
              <Icons.sparkles className="h-4 w-4 mr-2" />
              Auto-Approve (24h)
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-9"
              onClick={exportOci}
              disabled={busy !== null || loading}
              title="Export sealed conversions as OCI CSV"
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

      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Inbox / Gamification */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Inbox</div>
              {loading ? (
                <Skeleton className="h-5 w-16" />
              ) : stats?.inbox_zero_now ? (
                <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">Inbox Zero</Badge>
              ) : (
                <Badge variant="secondary">{fmt(stats?.queue_pending)} pending</Badge>
              )}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-slate-500">Sealed</div>
                <div className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.sealed)}</div>
              </div>
              <div>
                <div className="text-slate-500">Junk</div>
                <div className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.junk)}</div>
              </div>
              <div>
                <div className="text-slate-500">Auto</div>
                <div className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.auto_approved)}</div>
              </div>
            </div>

            <div className="mt-3 rounded-md bg-slate-100 p-2 text-sm">
              <div className="text-slate-500">Estimated budget saved</div>
              <div className="mt-0.5 font-semibold tabular-nums">
                {loading ? '…' : `${fmt(stats?.estimated_budget_saved)} ${currency}`}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="text-sm text-slate-500">Assumed CPC</div>
              <input
                value={cpcValue}
                onChange={(e) => setCpcDraft(e.target.value)}
                className="h-9 w-24 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums text-slate-950 outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                inputMode="decimal"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={saveCpc}
                disabled={busy !== null || loading}
              >
                {busy === 'save_cpc' ? (
                  <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Icons.check className="h-4 w-4 mr-2" />
                )}
                Save
              </Button>
            </div>
          </div>

          {/* OCI Pipeline */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">OCI Feedback Loop</div>
              <Badge variant="secondary">Today</Badge>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-600">
                  <Icons.seal className="h-4 w-4" />
                  <span>Sealed & matchable</span>
                </div>
                <span className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.oci_matchable_sealed)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-600">
                  <Icons.upload className="h-4 w-4" />
                  <span>Uploaded (exported)</span>
                </div>
                <span className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.oci_uploaded)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icons.alert className="h-4 w-4 text-rose-600" />
                  <span>Failed</span>
                </div>
                <span className="font-semibold tabular-nums">{loading ? '…' : fmt(stats?.oci_failed)}</span>
              </div>
            </div>

            <div className="mt-3 text-sm text-slate-500">
              “Matched” is shown when a click-id exists and an OCI export was generated. Google does not expose per-click match confirmation in a reliable way.
            </div>
          </div>

          {/* Human Bottleneck guardrail */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Human Bottleneck Guardrail</div>
              <Badge variant="secondary">24h</Badge>
            </div>
            <div className="mt-3 text-sm text-slate-500">
              If the queue is ignored, Ads learning starves. Auto-approve seals <span className="font-medium">only</span> low-risk intents (click-id present + non-bounce session).
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => refetch()}
                disabled={busy !== null}
              >
                <Icons.refresh className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              {busy === 'auto' && (
                <div className="text-sm text-muted-foreground">Auto-approving…</div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

