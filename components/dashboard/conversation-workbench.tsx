'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { SiteRole } from '@/lib/auth/rbac';
import { hasCapability } from '@/lib/auth/rbac';

type ConversationBucket = 'active' | 'overdue' | 'today' | 'unassigned' | 'all';

type ConversationInboxItem = {
  id: string;
  status: string;
  stage: string;
  assigned_to: string | null;
  phone_e164: string | null;
  customer_hash: string | null;
  mizan_predicted_value: number | null;
  last_activity_at: string;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  last_note_preview: string | null;
  primary_call_id: string | null;
  primary_session_id: string | null;
  source_summary?: Record<string, unknown> | null;
};

type ConversationInboxResponse = {
  items: ConversationInboxItem[];
  summary?: {
    filtered_total?: number;
    total_active?: number;
    overdue?: number;
    today?: number;
    unassigned?: number;
  };
};

type ConversationDetail = {
  conversation: ConversationInboxItem & {
    note?: string | null;
    source_summary?: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
    lost_reason?: string | null;
  };
  timeline: Array<{
    id: string;
    event_type: string;
    actor_type: string;
    created_at: string;
    payload?: Record<string, unknown> | null;
  }>;
  links: Array<{ id: string; entity_type: string; entity_id: string; created_at: string }>;
  sales: Array<{ id: string; amount_cents: number; currency: string; status: string; occurred_at: string }>;
  primary_call?: {
    id: string;
    phone_number: string | null;
    caller_phone_e164: string | null;
    intent_action: string | null;
    intent_target: string | null;
    status: string | null;
    source: string | null;
    lead_score: number | null;
    created_at: string;
    matched_session_id: string | null;
  } | null;
  primary_session?: {
    id: string;
    created_at: string;
    gclid: string | null;
    wbraid: string | null;
    gbraid: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    referrer_host: string | null;
  } | null;
  stats?: { timeline_count?: number; sales_count?: number; link_count?: number };
};

type AssigneeOption = {
  id: string;
  email: string | null;
  role: string;
  source: 'owner' | 'member';
};

const BUCKET_LABEL_KEYS: Record<ConversationBucket, string> = {
  active: 'crm.bucket.active',
  overdue: 'crm.bucket.overdue',
  today: 'crm.bucket.today',
  unassigned: 'crm.bucket.unassigned',
  all: 'crm.bucket.all',
};

const STAGE_OPTIONS = ['new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting'] as const;

function toInputDateTimeValue(date: Date) {
  const next = new Date(date.getTime() - (date.getTimezoneOffset() * 60 * 1000));
  return next.toISOString().slice(0, 16);
}

function conversationUrgency(item: ConversationInboxItem) {
  if (!item.assigned_to) {
    return { labelKey: 'crm.urgency.needsOwner', tone: 'border-amber-300 text-amber-700 bg-amber-50' };
  }
  if (item.next_follow_up_at) {
    const followUpTs = new Date(item.next_follow_up_at).getTime();
    const now = Date.now();
    if (followUpTs < now) {
      return { labelKey: 'crm.urgency.overdue', tone: 'border-rose-300 text-rose-700 bg-rose-50' };
    }
    if (new Date(item.next_follow_up_at).toDateString() === new Date().toDateString()) {
      return { labelKey: 'crm.urgency.dueToday', tone: 'border-sky-300 text-sky-700 bg-sky-50' };
    }
  }
  if (item.stage === 'qualified' || item.stage === 'proposal_sent') {
    return { labelKey: 'crm.urgency.highIntent', tone: 'border-emerald-300 text-emerald-700 bg-emerald-50' };
  }
  return { labelKey: 'crm.urgency.inMotion', tone: 'border-slate-300 text-slate-700 bg-slate-50' };
}

function stageLabelKey(stage: string) {
  switch (stage) {
    case 'new':
      return 'crm.stage.new';
    case 'contacted':
      return 'crm.stage.contacted';
    case 'qualified':
      return 'crm.stage.qualified';
    case 'proposal_sent':
      return 'crm.stage.proposalSent';
    case 'follow_up_waiting':
      return 'crm.stage.followUpWaiting';
    case 'won':
      return 'crm.stage.won';
    case 'lost':
      return 'crm.stage.lost';
    case 'junk':
      return 'crm.stage.junk';
    default:
      return stage;
  }
}

function statusLabelKey(status: string) {
  switch (status.toLowerCase()) {
    case 'open':
      return 'crm.status.open';
    case 'won':
      return 'crm.status.won';
    case 'lost':
      return 'crm.status.lost';
    case 'junk':
      return 'crm.status.junk';
    default:
      return status;
  }
}

function stageTone(stage: string) {
  if (stage === 'qualified' || stage === 'proposal_sent') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (stage === 'follow_up_waiting') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (stage === 'lost' || stage === 'junk') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (stage === 'won') return 'bg-sky-100 text-sky-800 border-sky-200';
  return 'bg-slate-100 text-slate-800 border-slate-200';
}

async function readJson<T>(input: RequestInfo, init?: RequestInit, fallbackError = 'İstek başarısız oldu'): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : fallbackError);
  }
  return body as T;
}

export function ConversationWorkbench({
  siteId,
  siteRole,
  currentUserId,
  title,
  description,
  initialBucket = 'active',
}: {
  siteId: string;
  siteRole: SiteRole;
  currentUserId?: string;
  title?: string;
  description?: string;
  initialBucket?: ConversationBucket;
}) {
  const { t, tUnsafe, formatTimestamp, formatNumber } = useTranslation();
  const canOperate = hasCapability(siteRole, 'queue:operate');
  const resolvedTitle = title ?? t('crm.workbench.title');
  const resolvedDescription = description ?? t('crm.workbench.description');
  const [bucket, setBucket] = useState<ConversationBucket>(initialBucket);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [inbox, setInbox] = useState<ConversationInboxResponse>({ items: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [draftFollowUp, setDraftFollowUp] = useState('');
  const [draftAssignedTo, setDraftAssignedTo] = useState('');
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setBucket(initialBucket);
  }, [initialBucket]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => setSuccessMessage(null), 2800);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadInbox() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          site_id: siteId,
          bucket,
          limit: '50',
        });
        if (search.trim()) params.set('search', search.trim());
        const data = await readJson<ConversationInboxResponse>(`/api/conversations?${params.toString()}`, {
          signal: controller.signal,
        }, t('crm.error.requestFailed'));
        if (!cancelled) setInbox(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('crm.error.loadConversations'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInbox();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [siteId, bucket, search, refreshTick, t]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadDetail() {
      try {
        const data = await readJson<ConversationDetail>(`/api/conversations/${selectedId}`, { signal: controller.signal }, t('crm.error.requestFailed'));
        if (!cancelled) {
          setDetail(data);
          setDraftNote(data.conversation.note ?? '');
          setDraftAssignedTo(data.conversation.assigned_to ?? '');
          setDraftFollowUp(
            data.conversation.next_follow_up_at
              ? new Date(data.conversation.next_follow_up_at).toISOString().slice(0, 16)
              : ''
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('crm.error.loadDetail'));
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId, refreshTick, t]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadAssignees() {
      try {
        const data = await readJson<{ items: AssigneeOption[] }>(`/api/sites/${siteId}/assignees`, {
          signal: controller.signal,
        }, t('crm.error.requestFailed'));
        if (!cancelled) setAssignees(data.items ?? []);
      } catch {
        if (!cancelled) setAssignees([]);
      }
    }

    void loadAssignees();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [siteId, t]);

  const summaryCards = useMemo(
    () => [
      { label: t('crm.summary.active'), value: inbox.summary?.total_active ?? 0 },
      { label: t('crm.summary.overdue'), value: inbox.summary?.overdue ?? 0 },
      { label: t('crm.summary.today'), value: inbox.summary?.today ?? 0 },
      { label: t('crm.summary.unassigned'), value: inbox.summary?.unassigned ?? 0 },
    ],
    [inbox.summary, t]
  );

  const deskFocus = useMemo(() => {
    const now = Date.now();
    const todayKey = new Date().toDateString();
    return {
      hottest: inbox.items.slice(0, 3),
      overdue: inbox.items
        .filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at).getTime() < now)
        .slice(0, 3),
      today: inbox.items
        .filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at).toDateString() === todayKey)
        .slice(0, 3),
    };
  }, [inbox.items]);

  const operatorPulse = useMemo(() => {
    if (!currentUserId) return [];
    const now = Date.now();
    const todayKey = new Date().toDateString();
    const mine = inbox.items.filter((item) => item.assigned_to === currentUserId);
    return [
      { label: t('crm.operatorPulse.myActive'), value: mine.length },
      {
        label: t('crm.operatorPulse.myOverdue'),
        value: mine.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at).getTime() < now).length,
      },
      {
        label: t('crm.operatorPulse.myToday'),
        value: mine.filter((item) => item.next_follow_up_at && new Date(item.next_follow_up_at).toDateString() === todayKey).length,
      },
      {
        label: t('crm.operatorPulse.unassigned'),
        value: inbox.items.filter((item) => !item.assigned_to).length,
      },
    ];
  }, [currentUserId, inbox.items, t]);

  function assigneeLabel(id: string | null | undefined) {
    if (!id) return t('crm.bucket.unassigned');
    const row = assignees.find((item) => item.id === id);
    if (!row) return `${id.slice(0, 8)}...`;
    return row.email || `${row.role}:${row.id.slice(0, 8)}`;
  }

  async function refreshAll() {
    setRefreshTick((x) => x + 1);
  }

  async function openConversation(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  async function runMutation(path: string, body: Record<string, unknown>, successText?: string) {
    setSaving(true);
    setError(null);
    try {
      await readJson(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }, t('crm.error.requestFailed'));
      setSuccessMessage(successText || t('crm.success.saved'));
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('crm.error.mutationFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle className="text-xl text-slate-900">{resolvedTitle}</CardTitle>
              <CardDescription>{resolvedDescription}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('crm.searchPlaceholder')}
                className="h-10 w-72 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400"
              />
              <Button variant="outline" onClick={() => void refreshAll()} disabled={loading || saving}>
                {t('button.refresh')}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{card.value}</div>
              </div>
            ))}
          </div>
          {operatorPulse.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('crm.operatorPulse.title')}</div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                {operatorPulse.map((card) => (
                  <div key={card.label} className="rounded-lg border border-white bg-white px-3 py-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-slate-900">{card.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`grid gap-4 ${currentUserId ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('crm.rail.deskFocus')}</div>
              <div className="mt-2 text-sm font-medium text-slate-900">{t('crm.rail.hottestTitle')}</div>
              <div className="mt-3 space-y-2">
                {deskFocus.hottest.map((item) => (
                  <button
                    key={`hot-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-slate-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{tUnsafe(stageLabelKey(item.stage))} | {t('crm.field.predictedValue')} {formatNumber(item.mizan_predicted_value ?? 0)}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">{t('crm.rail.overdueNow')}</div>
              <div className="mt-2 text-sm font-medium text-amber-900">{t('crm.rail.overdueSubtitle')}</div>
              <div className="mt-3 space-y-2">
                {deskFocus.overdue.length === 0 ? <div className="text-sm text-amber-700">{t('crm.rail.noOverdue')}</div> : deskFocus.overdue.map((item) => (
                  <button
                    key={`over-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm hover:border-amber-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{item.next_follow_up_at ? formatTimestamp(item.next_follow_up_at) : '—'}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">{t('crm.rail.todayDesk')}</div>
              <div className="mt-2 text-sm font-medium text-sky-900">{t('crm.rail.todaySubtitle')}</div>
              <div className="mt-3 space-y-2">
                {deskFocus.today.length === 0 ? <div className="text-sm text-sky-700">{t('crm.rail.noToday')}</div> : deskFocus.today.map((item) => (
                  <button
                    key={`today-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-left text-sm hover:border-sky-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{item.last_note_preview || tUnsafe(stageLabelKey(item.stage))}</div>
                  </button>
                ))}
              </div>
            </div>
            {currentUserId ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{t('crm.rail.myDesk')}</div>
                <div className="mt-2 text-sm font-medium text-emerald-900">{t('crm.rail.myDeskSubtitle')}</div>
                <div className="mt-3 space-y-2">
                  {inbox.items.filter((item) => item.assigned_to === currentUserId).slice(0, 3).length === 0 ? (
                    <div className="text-sm text-emerald-700">{t('crm.rail.noMine')}</div>
                  ) : inbox.items.filter((item) => item.assigned_to === currentUserId).slice(0, 3).map((item) => (
                    <button
                      key={`mine-${item.id}`}
                      type="button"
                      onClick={() => void openConversation(item.id)}
                      className="block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-300"
                    >
                      <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                      <div className="text-xs text-slate-500">{item.last_note_preview || tUnsafe(stageLabelKey(item.stage))}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <Tabs value={bucket} onValueChange={(value) => setBucket(value as ConversationBucket)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-5">
              {(Object.keys(BUCKET_LABEL_KEYS) as ConversationBucket[]).map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                >
                  {tUnsafe(BUCKET_LABEL_KEYS[key])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
          ) : null}
          {successMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {successMessage}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              {t('crm.state.loadingConversations')}
            </div>
          ) : inbox.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              {t('crm.state.emptyBucket')}
            </div>
          ) : (
            <div className="space-y-3">
              {inbox.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void openConversation(item.id)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={stageTone(item.stage)}>{tUnsafe(stageLabelKey(item.stage))}</Badge>
                        <Badge variant="outline" className={conversationUrgency(item).tone}>
                          {tUnsafe(conversationUrgency(item).labelKey)}
                        </Badge>
                        <span className="font-mono text-xs text-slate-500">{item.id.slice(0, 8)}</span>
                        {item.assigned_to ? (
                          <Badge variant="outline" className="border-slate-300 text-slate-700">
                            {assigneeLabel(item.assigned_to)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-300 text-amber-700">
                            {t('crm.state.unassigned')}
                          </Badge>
                        )}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        {item.phone_e164 || item.customer_hash || t('crm.state.identityPending')}
                      </div>
                      <div className="text-sm text-slate-500">
                        {item.last_note_preview || t('crm.state.noNote')}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                        {item.source_summary?.source ? <Badge variant="outline">{String(item.source_summary.source)}</Badge> : null}
                        {item.source_summary?.intent_action ? <Badge variant="outline">{String(item.source_summary.intent_action)}</Badge> : null}
                        {item.source_summary?.utm_source ? <Badge variant="outline">{String(item.source_summary.utm_source)}</Badge> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 lg:min-w-[280px]">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">{t('crm.field.followUp')}</div>
                        <div>{item.next_follow_up_at ? formatTimestamp(item.next_follow_up_at) : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">{t('crm.field.lastActivity')}</div>
                        <div>{formatTimestamp(item.last_activity_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">{t('crm.field.predictedValue')}</div>
                        <div className="font-semibold text-slate-900">
                          {formatNumber(item.mizan_predicted_value ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">{t('crm.field.links')}</div>
                        <div>{item.primary_call_id ? t('crm.entity.call') : ''}{item.primary_call_id && item.primary_session_id ? ' + ' : ''}{item.primary_session_id ? t('crm.entity.session') : '—'}</div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t('crm.detail.title')}</SheetTitle>
            <SheetDescription>
              {t('crm.detail.description')}
            </SheetDescription>
          </SheetHeader>

          {!detail ? (
            <div className="mt-6 text-sm text-slate-500">{t('crm.detail.loading')}</div>
          ) : (
            <div className="mt-6 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {detail.conversation.phone_e164 || detail.conversation.customer_hash || detail.conversation.id}
                  </CardTitle>
                  <CardDescription>
                    {tUnsafe(stageLabelKey(detail.conversation.stage))} | {tUnsafe(statusLabelKey(detail.conversation.status))}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-slate-400">{t('crm.field.nextFollowUp')}</div>
                    <div>{detail.conversation.next_follow_up_at ? formatTimestamp(detail.conversation.next_follow_up_at) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">{t('crm.field.lastActivity')}</div>
                    <div>{formatTimestamp(detail.conversation.last_activity_at)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">{t('crm.field.predictedValue')}</div>
                    <div>{formatNumber(detail.conversation.mizan_predicted_value ?? 0)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">{t('crm.field.stats')}</div>
                    <div>
                      {t('crm.field.statsSummary', {
                        events: detail.stats?.timeline_count ?? 0,
                        sales: detail.stats?.sales_count ?? 0,
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">{t('crm.field.assignee')}</div>
                    <div>{assigneeLabel(detail.conversation.assigned_to)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">{t('crm.field.primaryEvidence')}</div>
                    <div>{detail.conversation.primary_call_id ? t('crm.entity.call') : '—'} / {detail.conversation.primary_session_id ? t('crm.entity.session') : '—'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-slate-400">{t('crm.field.operatorBrief')}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant="outline" className={conversationUrgency(detail.conversation).tone}>
                        {tUnsafe(conversationUrgency(detail.conversation).labelKey)}
                      </Badge>
                      {detail.conversation.source_summary?.source ? <Badge variant="outline">{String(detail.conversation.source_summary.source)}</Badge> : null}
                      {detail.conversation.source_summary?.intent_action ? <Badge variant="outline">{String(detail.conversation.source_summary.intent_action)}</Badge> : null}
                      {detail.conversation.source_summary?.utm_source ? <Badge variant="outline">{String(detail.conversation.source_summary.utm_source)}</Badge> : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('crm.actions.title')}</CardTitle>
                  <CardDescription>{t('crm.actions.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.field.assignee')}</label>
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={draftAssignedTo}
                        onChange={(e) => setDraftAssignedTo(e.target.value)}
                        className="h-10 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">{t('crm.bucket.unassigned')}</option>
                        {assignees.map((assignee) => (
                          <option key={assignee.id} value={assignee.id}>
                            {(assignee.email || `${assignee.role}:${assignee.id.slice(0, 8)}`)} ({assignee.role})
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate || saving}
                        onClick={() => void runMutation('/api/conversations/assign', {
                          conversation_id: detail.conversation.id,
                          assigned_to: draftAssignedTo || null,
                        }, t('crm.success.assigneeUpdated'))}
                      >
                        {t('crm.actions.applyAssignee')}
                      </Button>
                      {currentUserId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canOperate || saving}
                          onClick={() => {
                            setDraftAssignedTo(currentUserId);
                            void runMutation('/api/conversations/assign', {
                              conversation_id: detail.conversation.id,
                              assigned_to: currentUserId,
                            }, t('crm.success.assignedToYou'));
                          }}
                        >
                          {t('crm.actions.assignMe')}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {STAGE_OPTIONS.map((stage) => (
                      <Button
                        key={stage}
                        size="sm"
                        variant={detail.conversation.stage === stage ? 'default' : 'outline'}
                        disabled={!canOperate || saving}
                        onClick={() => void runMutation('/api/conversations/stage', {
                          conversation_id: detail.conversation.id,
                          stage,
                          next_follow_up_at: draftFollowUp ? new Date(draftFollowUp).toISOString() : null,
                        }, t('crm.success.stageChanged'))}
                      >
                        {tUnsafe(stageLabelKey(stage))}
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.actions.followUpAt')}</label>
                    <input
                      type="datetime-local"
                      value={draftFollowUp}
                      onChange={(e) => setDraftFollowUp(e.target.value)}
                      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate || saving}
                        onClick={() => setDraftFollowUp(toInputDateTimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000)))}
                      >
                        {t('crm.actions.quick.in2Hours')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate || saving}
                        onClick={() => {
                          const next = new Date();
                          next.setHours(15, 0, 0, 0);
                          setDraftFollowUp(toInputDateTimeValue(next));
                        }}
                      >
                        {t('crm.actions.quick.today1500')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate || saving}
                        onClick={() => {
                          const next = new Date();
                          next.setDate(next.getDate() + 1);
                          next.setHours(9, 30, 0, 0);
                          setDraftFollowUp(toInputDateTimeValue(next));
                        }}
                      >
                        {t('crm.actions.quick.tomorrow0930')}
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canOperate || saving || !draftFollowUp}
                      onClick={() => void runMutation('/api/conversations/follow-up', {
                        conversation_id: detail.conversation.id,
                        next_follow_up_at: new Date(draftFollowUp).toISOString(),
                        note: draftNote || null,
                      }, t('crm.success.followUpScheduled'))}
                    >
                      {t('crm.actions.setFollowUp')}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.actions.note')}</label>
                    <Textarea
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder={t('crm.actions.notePlaceholder')}
                      rows={5}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!canOperate || saving || !draftNote.trim()}
                        onClick={() => void runMutation('/api/conversations/note', {
                          conversation_id: detail.conversation.id,
                          note: draftNote,
                        }, t('crm.success.noteSaved'))}
                      >
                        {t('crm.actions.saveNote')}
                      </Button>
                      {detail.conversation.stage === 'won' || detail.conversation.stage === 'lost' || detail.conversation.stage === 'junk' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canOperate || saving}
                          onClick={() => void runMutation('/api/conversations/reopen', {
                            conversation_id: detail.conversation.id,
                            stage: 'follow_up_waiting',
                            next_follow_up_at: draftFollowUp ? new Date(draftFollowUp).toISOString() : null,
                            note: draftNote || null,
                          }, t('crm.success.reopened'))}
                        >
                          {t('crm.actions.reopen')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('crm.evidence.title')}</CardTitle>
                  <CardDescription>{t('crm.evidence.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.evidence.sourceSummary')}</div>
                    <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {JSON.stringify(detail.conversation.source_summary ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.evidence.primaryCall')}</div>
                      {detail.primary_call ? (
                        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {JSON.stringify(detail.primary_call, null, 2)}
                        </pre>
                      ) : (
                        <div className="text-sm text-slate-500">{t('crm.evidence.noPrimaryCall')}</div>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.evidence.primarySession')}</div>
                      {detail.primary_session ? (
                        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {JSON.stringify(detail.primary_session, null, 2)}
                        </pre>
                      ) : (
                        <div className="text-sm text-slate-500">{t('crm.evidence.noPrimarySession')}</div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.field.links')}</div>
                      <div className="space-y-2">
                        {detail.links.length === 0 ? (
                          <div className="text-sm text-slate-500">{t('crm.evidence.noLinks')}</div>
                        ) : detail.links.map((link) => (
                          <div key={link.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <div className="font-medium text-slate-900">{link.entity_type}</div>
                            <div className="font-mono text-xs text-slate-500">{link.entity_id}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('crm.evidence.sales')}</div>
                      <div className="space-y-2">
                        {detail.sales.length === 0 ? (
                          <div className="text-sm text-slate-500">{t('crm.evidence.noSales')}</div>
                        ) : detail.sales.map((sale) => (
                          <div key={sale.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <div className="font-medium text-slate-900">{sale.status}</div>
                            <div>{sale.amount_cents} {sale.currency}</div>
                            <div className="text-xs text-slate-500">{formatTimestamp(sale.occurred_at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('crm.timeline.title')}</CardTitle>
                  <CardDescription>{t('crm.timeline.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.timeline.length === 0 ? (
                    <div className="text-sm text-slate-500">{t('crm.timeline.empty')}</div>
                  ) : (
                    detail.timeline.map((event) => (
                      <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-slate-900">{event.event_type}</div>
                          <div className="text-xs text-slate-500">{formatTimestamp(event.created_at)}</div>
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-wider text-slate-400">{event.actor_type}</div>
                        {event.payload ? (
                          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-slate-700">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
