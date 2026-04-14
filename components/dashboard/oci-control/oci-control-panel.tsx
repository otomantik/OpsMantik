'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Ban,
  Home,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OciQueueStats, OciQueueRow, QueueStatus } from '@/lib/domain/oci/queue-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { TranslationKey } from '@/lib/i18n/t';

const STATUS_ORDER: QueueStatus[] = [
  'QUEUED',
  'RETRY',
  'PROCESSING',
  'UPLOADED',
  'COMPLETED',
  'COMPLETED_UNVERIFIED',
  'FAILED',
  'DEAD_LETTER_QUARANTINE',
];

function statusLabel(
  status: QueueStatus | string,
  tUnsafe: (key: string, params?: Record<string, string | number>) => string
) {
  return tUnsafe(`ociControl.status.${status}`);
}

export function OciControlPanel({
  siteId,
  siteName,
  canOperate,
}: {
  siteId: string;
  siteName?: string;
  canOperate: boolean;
}) {
  const { t, tUnsafe } = useTranslation();
  const [stats, setStats] = useState<OciQueueStats | null>(null);
  const [rows, setRows] = useState<OciQueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);
  const labels = {
    title: t('ociControl.title'),
    subtitle: t('ociControl.subtitle'),
    allStatuses: t('ociControl.allStatuses'),
    refresh: t('ociControl.refresh'),
    autoRefresh10s: t('ociControl.autoRefresh10s'),
    retrySelected: t('ociControl.retrySelected'),
    resetToQueued: t('ociControl.resetToQueued'),
    markFailed: t('ociControl.markFailed'),
    readOnly: t('hunter.readOnlyRole'),
    select: t('ociControl.selectShort'),
    callId: t('ociControl.callId'),
    errorCode: t('ociControl.errorCode'),
    id: t('ociControl.id'),
    status: t('ociControl.status'),
    category: t('ociControl.category'),
    stuck: t('ociControl.stuck'),
    lastError: t('ociControl.lastError'),
    attempts: t('ociControl.attempts'),
    updated: t('ociControl.updated'),
    actions: t('ociControl.actions'),
    loading: t('ociControl.loading'),
    loadMore: t('ociControl.loadMore'),
    loadStatsError: t('ociControl.error.loadStats'),
    loadRowsError: t('ociControl.error.loadRows'),
    actionFailed: t('ociControl.error.actionFailed'),
  };

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/oci/queue-stats?siteId=${encodeURIComponent(siteId)}`);
      if (!res.ok) throw new Error(labels.loadStatsError);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.loadStatsError);
    }
  }, [labels.loadStatsError, siteId]);

  const fetchRows = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ siteId, limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/oci/queue-rows?${params.toString()}`);
      if (!res.ok) throw new Error(labels.loadRowsError);
      const data = await res.json();
      setRows(data.rows ?? []);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : labels.loadRowsError);
    } finally {
      setLoading(false);
    }
  }, [labels.loadRowsError, siteId, statusFilter]);

  const refresh = useCallback(() => {
    fetchStats();
    fetchRows();
  }, [fetchStats, fetchRows]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      fetchStats();
      fetchRows();
    }, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchStats, fetchRows]);

  const runAction = useCallback(
    async (action: 'RETRY_SELECTED' | 'RESET_TO_QUEUED' | 'MARK_FAILED', ids: string[], reason?: string) => {
      if (!canOperate || ids.length === 0) return;
      setActionBusy(true);
      try {
        const body: { siteId: string; action: string; ids: string[]; reason?: string; clearErrors?: boolean } = {
          siteId,
          action,
          ids,
        };
        if (action === 'MARK_FAILED' && reason) body.reason = reason;
        if (action === 'RESET_TO_QUEUED') body.clearErrors = false;
        const res = await fetch('/api/oci/queue-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(labels.actionFailed);
        setSelectedIds(new Set());
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : labels.actionFailed);
      } finally {
        setActionBusy(false);
      }
    },
    [canOperate, labels.actionFailed, siteId, refresh]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // const selectAll = () => {
  //   if (selectedIds.size === rows.length) setSelectedIds(new Set());
  //   else setSelectedIds(new Set(rows.map((r) => r.id)));
  // };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-h-[44px]">
              <Link
                href={`/dashboard/site/${siteId}`}
                className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-[44px] px-3')}
              >
                <Home className="h-5 w-5 mr-2" />
                {siteName || siteId}
              </Link>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {labels.title}
              </span>
              <span className="hidden md:block text-xs text-slate-400">
                {labels.subtitle}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter((current) => current === status ? '' : status)}
              className="text-left"
            >
            <Card className={cn(
              'border-slate-200 bg-white transition hover:border-slate-300',
              statusFilter === status && 'border-slate-900 ring-2 ring-slate-900/10'
            )}>
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  {status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                  {status === 'FAILED' && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                  {status === 'PROCESSING' && <Clock className="h-3.5 w-3.5 text-slate-500" />}
                  {status === 'RETRY' && <RotateCcw className="h-3.5 w-3.5 text-amber-600" />}
                  {statusLabel(status, tUnsafe)}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <span className="text-xl font-bold tabular-nums text-slate-900">
                  {stats?.totals?.[status] ?? '—'}
                </span>
              </CardContent>
            </Card>
            </button>
          ))}
          {typeof stats?.stuckProcessing === 'number' && stats.stuckProcessing > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {labels.stuck}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <span className="text-xl font-bold tabular-nums text-amber-900">
                  {stats.stuckProcessing}
                </span>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">{labels.allStatuses}</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{statusLabel(s, tUnsafe)}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="default"
            className="min-h-[44px]"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            {labels.refresh}
          </Button>
          <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">{labels.autoRefresh10s}</span>
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                className="min-h-[44px]"
                disabled={!canOperate || actionBusy}
                onClick={() => runAction('RETRY_SELECTED', Array.from(selectedIds))}
                title={!canOperate ? labels.readOnly : undefined}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {labels.retrySelected} ({selectedIds.size})
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px]"
                disabled={!canOperate || actionBusy}
                onClick={() => runAction('RESET_TO_QUEUED', Array.from(selectedIds))}
                title={!canOperate ? labels.readOnly : undefined}
              >
                {labels.resetToQueued}
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px] border-red-200 text-red-700 hover:bg-red-50"
                disabled={!canOperate || actionBusy}
                onClick={() => runAction('MARK_FAILED', Array.from(selectedIds), 'MANUALLY_MARKED_FAILED')}
                title={!canOperate ? labels.readOnly : undefined}
              >
                <Ban className="h-4 w-4 mr-2" />
                {labels.markFailed}
              </Button>
            </div>
          )}
        </div>

        <Card className="border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200">
                <TableHead className="w-10 min-h-[44px]">{labels.select}</TableHead>
                <TableHead className="min-h-[44px]">{labels.id}</TableHead>
                <TableHead className="min-h-[44px]">{labels.callId}</TableHead>
                <TableHead className="min-h-[44px]">{labels.status}</TableHead>
                <TableHead className="min-h-[44px]">{labels.errorCode}</TableHead>
                <TableHead className="min-h-[44px]">{labels.category}</TableHead>
                <TableHead className="min-h-[44px]">{labels.lastError}</TableHead>
                <TableHead className="min-h-[44px]">{labels.attempts}</TableHead>
                <TableHead className="min-h-[44px]">{labels.updated}</TableHead>
                <TableHead className="min-h-[44px]">{labels.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-slate-500">
                    {labels.loading}...
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id} className="border-slate-100">
                    <TableCell className="py-2">
                      {(row.status === 'FAILED' || row.status === 'RETRY') && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                          className="rounded border-slate-300 h-4 w-4 min-w-[44px] min-h-[44px] cursor-pointer"
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs py-2">{row.id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs py-2">{row.call_id?.slice(0, 8) ?? '—'}</TableCell>
                    <TableCell className="py-2">
                      <span
                        className={cn(
                          'inline-flex px-2 py-0.5 text-xs font-bold uppercase rounded',
                          row.status === 'COMPLETED' && 'bg-emerald-100 text-emerald-800',
                          row.status === 'FAILED' && 'bg-red-100 text-red-800',
                          row.status === 'PROCESSING' && 'bg-slate-100 text-slate-700',
                          row.status === 'RETRY' && 'bg-amber-100 text-amber-800',
                          row.status === 'QUEUED' && 'bg-slate-100 text-slate-600'
                        )}
                      >
                        {statusLabel(row.status, tUnsafe)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs py-2">{row.provider_error_code ?? '—'}</TableCell>
                    <TableCell className="text-xs py-2">{row.provider_error_category ?? '—'}</TableCell>
                    <TableCell className="text-xs py-2 max-w-[200px] truncate" title={row.last_error ?? ''}>
                      {row.last_error ?? '—'}
                    </TableCell>
                    <TableCell className="tabular-nums py-2">{row.attempt_count}</TableCell>
                    <TableCell className="text-xs text-slate-600 py-2">
                      {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="py-2">
                      {(row.status === 'FAILED' || row.status === 'RETRY') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px] min-w-[44px]"
                          disabled={!canOperate || actionBusy}
                          onClick={() => runAction('RETRY_SELECTED', [row.id])}
                          title={!canOperate ? labels.readOnly : undefined}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {nextCursor && (
          <div className="mt-4">
            <Button variant="outline" className="min-h-[44px]" onClick={() => fetchRows(nextCursor)}>
              {labels.loadMore}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
