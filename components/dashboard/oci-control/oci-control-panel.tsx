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

const STATUS_ORDER: QueueStatus[] = ['QUEUED', 'RETRY', 'PROCESSING', 'COMPLETED', 'FAILED'];

export function OciControlPanel({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName?: string;
}) {
  const [stats, setStats] = useState<OciQueueStats | null>(null);
  const [rows, setRows] = useState<OciQueueRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/oci/queue-stats?siteId=${encodeURIComponent(siteId)}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats');
    }
  }, [siteId]);

  const fetchRows = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ siteId, limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/oci/queue-rows?${params.toString()}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setRows(data.rows ?? []);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rows');
    } finally {
      setLoading(false);
    }
  }, [siteId, statusFilter]);

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
      if (ids.length === 0) return;
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
        if (!res.ok) throw new Error(await res.text());
        setSelectedIds(new Set());
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setActionBusy(false);
      }
    },
    [siteId, refresh]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r) => r.id)));
  };

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
                OCI Control
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
            <Card key={status} className="border-slate-200 bg-white">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  {status === 'COMPLETED' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                  {status === 'FAILED' && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                  {status === 'PROCESSING' && <Clock className="h-3.5 w-3.5 text-slate-500" />}
                  {status === 'RETRY' && <RotateCcw className="h-3.5 w-3.5 text-amber-600" />}
                  {status}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <span className="text-xl font-bold tabular-nums text-slate-900">
                  {stats?.totals?.[status] ?? '—'}
                </span>
              </CardContent>
            </Card>
          ))}
          {typeof stats?.stuckProcessing === 'number' && stats.stuckProcessing > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader className="p-3 pb-0">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Stuck
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
            <option value="">All statuses</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{s}</option>
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
            Refresh
          </Button>
          <label className="flex items-center gap-2 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm text-slate-700">Auto-refresh 10s</span>
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                className="min-h-[44px]"
                disabled={actionBusy}
                onClick={() => runAction('RETRY_SELECTED', Array.from(selectedIds))}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Retry ({selectedIds.size})
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px]"
                disabled={actionBusy}
                onClick={() => runAction('RESET_TO_QUEUED', Array.from(selectedIds))}
              >
                Reset to QUEUED
              </Button>
              <Button
                variant="outline"
                className="min-h-[44px] border-red-200 text-red-700 hover:bg-red-50"
                disabled={actionBusy}
                onClick={() => runAction('MARK_FAILED', Array.from(selectedIds), 'MANUALLY_MARKED_FAILED')}
              >
                <Ban className="h-4 w-4 mr-2" />
                Mark FAILED
              </Button>
            </div>
          )}
        </div>

        <Card className="border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200">
                <TableHead className="w-10 min-h-[44px]">Sel</TableHead>
                <TableHead className="min-h-[44px]">ID</TableHead>
                <TableHead className="min-h-[44px]">Call ID</TableHead>
                <TableHead className="min-h-[44px]">Status</TableHead>
                <TableHead className="min-h-[44px]">Error Code</TableHead>
                <TableHead className="min-h-[44px]">Category</TableHead>
                <TableHead className="min-h-[44px]">Last Error</TableHead>
                <TableHead className="min-h-[44px]">Attempts</TableHead>
                <TableHead className="min-h-[44px]">Updated</TableHead>
                <TableHead className="min-h-[44px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-slate-500">
                    Loading...
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
                        {row.status}
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
                          disabled={actionBusy}
                          onClick={() => runAction('RETRY_SELECTED', [row.id])}
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
              Load more
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
