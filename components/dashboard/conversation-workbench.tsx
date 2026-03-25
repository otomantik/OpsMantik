'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { formatTimestamp } from '@/lib/utils';
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

const BUCKET_LABELS: Record<ConversationBucket, string> = {
  active: 'Active',
  overdue: 'Overdue',
  today: 'Today',
  unassigned: 'Unassigned',
  all: 'All',
};

const STAGE_OPTIONS = ['new', 'contacted', 'qualified', 'proposal_sent', 'follow_up_waiting'] as const;

function stageTone(stage: string) {
  if (stage === 'qualified' || stage === 'proposal_sent') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (stage === 'follow_up_waiting') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (stage === 'lost' || stage === 'junk') return 'bg-rose-100 text-rose-800 border-rose-200';
  if (stage === 'won') return 'bg-sky-100 text-sky-800 border-sky-200';
  return 'bg-slate-100 text-slate-800 border-slate-200';
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
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
    throw new Error(typeof body?.error === 'string' ? body.error : 'Request failed');
  }
  return body as T;
}

export function ConversationWorkbench({
  siteId,
  siteRole,
  title = 'Conversation Workbench',
  description = 'Conversation-first operator surface. Calls are evidence, conversations are the work object.',
}: {
  siteId: string;
  siteRole: SiteRole;
  title?: string;
  description?: string;
}) {
  const canOperate = hasCapability(siteRole, 'queue:operate');
  const [bucket, setBucket] = useState<ConversationBucket>('active');
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
        });
        if (!cancelled) setInbox(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load conversations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInbox();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [siteId, bucket, search, refreshTick]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadDetail() {
      try {
        const data = await readJson<ConversationDetail>(`/api/conversations/${selectedId}`, { signal: controller.signal });
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load detail');
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedId, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadAssignees() {
      try {
        const data = await readJson<{ items: AssigneeOption[] }>(`/api/sites/${siteId}/assignees`, {
          signal: controller.signal,
        });
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
  }, [siteId]);

  const summaryCards = useMemo(
    () => [
      { label: 'Active', value: inbox.summary?.total_active ?? 0 },
      { label: 'Overdue', value: inbox.summary?.overdue ?? 0 },
      { label: 'Today', value: inbox.summary?.today ?? 0 },
      { label: 'Unassigned', value: inbox.summary?.unassigned ?? 0 },
    ],
    [inbox.summary]
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

  function assigneeLabel(id: string | null | undefined) {
    if (!id) return 'Unassigned';
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

  async function runMutation(path: string, body: Record<string, unknown>, successText = 'Saved') {
    setSaving(true);
    setError(null);
    try {
      await readJson(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSuccessMessage(successText);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mutation failed');
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
              <CardTitle className="text-xl text-slate-900">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search phone, customer hash, note"
                className="h-10 w-72 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400"
              />
              <Button variant="outline" onClick={() => void refreshAll()} disabled={loading || saving}>
                Refresh
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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Desk Focus</div>
              <div className="mt-2 text-sm font-medium text-slate-900">Hottest conversations</div>
              <div className="mt-3 space-y-2">
                {deskFocus.hottest.map((item) => (
                  <button
                    key={`hot-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-slate-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{item.stage} | value {item.mizan_predicted_value ?? 0}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Overdue Now</div>
              <div className="mt-2 text-sm font-medium text-amber-900">Needs immediate operator touch</div>
              <div className="mt-3 space-y-2">
                {deskFocus.overdue.length === 0 ? <div className="text-sm text-amber-700">No overdue conversations.</div> : deskFocus.overdue.map((item) => (
                  <button
                    key={`over-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm hover:border-amber-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{item.next_follow_up_at ? formatTimestamp(item.next_follow_up_at) : 'No follow-up'}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">Today Desk</div>
              <div className="mt-2 text-sm font-medium text-sky-900">Due today and ready to move</div>
              <div className="mt-3 space-y-2">
                {deskFocus.today.length === 0 ? <div className="text-sm text-sky-700">No today items.</div> : deskFocus.today.map((item) => (
                  <button
                    key={`today-${item.id}`}
                    type="button"
                    onClick={() => void openConversation(item.id)}
                    className="block w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-left text-sm hover:border-sky-300"
                  >
                    <div className="font-medium text-slate-900">{item.phone_e164 || item.customer_hash || item.id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-500">{item.last_note_preview || item.stage}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Tabs value={bucket} onValueChange={(value) => setBucket(value as ConversationBucket)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-5">
              {(Object.keys(BUCKET_LABELS) as ConversationBucket[]).map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="rounded-md border border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white"
                >
                  {BUCKET_LABELS[key]}
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
              Loading conversations...
            </div>
          ) : inbox.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
              No conversations in this bucket yet.
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
                        <Badge className={stageTone(item.stage)}>{item.stage}</Badge>
                        <span className="font-mono text-xs text-slate-500">{item.id.slice(0, 8)}</span>
                        {item.assigned_to ? (
                          <Badge variant="outline" className="border-slate-300 text-slate-700">
                            {assigneeLabel(item.assigned_to)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-300 text-amber-700">
                            unassigned
                          </Badge>
                        )}
                      </div>
                      <div className="text-base font-semibold text-slate-900">
                        {item.phone_e164 || item.customer_hash || 'identity pending'}
                      </div>
                      <div className="text-sm text-slate-500">
                        {item.last_note_preview || 'No note yet'}
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                        {item.source_summary?.source ? <Badge variant="outline">{String(item.source_summary.source)}</Badge> : null}
                        {item.source_summary?.intent_action ? <Badge variant="outline">{String(item.source_summary.intent_action)}</Badge> : null}
                        {item.source_summary?.utm_source ? <Badge variant="outline">{String(item.source_summary.utm_source)}</Badge> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm text-slate-600 lg:min-w-[280px]">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">Follow-up</div>
                        <div>{item.next_follow_up_at ? formatTimestamp(item.next_follow_up_at) : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">Last activity</div>
                        <div>{formatTimestamp(item.last_activity_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">Predicted value</div>
                        <div className="font-semibold text-slate-900">
                          {typeof item.mizan_predicted_value === 'number' ? item.mizan_predicted_value : 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">Links</div>
                        <div>{item.primary_call_id ? 'call' : ''}{item.primary_call_id && item.primary_session_id ? ' + ' : ''}{item.primary_session_id ? 'session' : '—'}</div>
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
            <SheetTitle>Conversation Detail</SheetTitle>
            <SheetDescription>
              Inspect the timeline and work the conversation without dropping into raw call rows.
            </SheetDescription>
          </SheetHeader>

          {!detail ? (
            <div className="mt-6 text-sm text-slate-500">Loading detail...</div>
          ) : (
            <div className="mt-6 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {detail.conversation.phone_e164 || detail.conversation.customer_hash || detail.conversation.id}
                  </CardTitle>
                  <CardDescription>
                    Stage `{detail.conversation.stage}` | status `{detail.conversation.status}`
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-slate-400">Next follow-up</div>
                    <div>{detail.conversation.next_follow_up_at ? formatTimestamp(detail.conversation.next_follow_up_at) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Last activity</div>
                    <div>{formatTimestamp(detail.conversation.last_activity_at)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Predicted value</div>
                    <div>{detail.conversation.mizan_predicted_value ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Stats</div>
                    <div>
                      {detail.stats?.timeline_count ?? 0} events, {detail.stats?.sales_count ?? 0} sales
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Assignee</div>
                    <div>{assigneeLabel(detail.conversation.assigned_to)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Primary evidence</div>
                    <div>{detail.conversation.primary_call_id ? 'call' : '—'} / {detail.conversation.primary_session_id ? 'session' : '—'}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Operator Actions</CardTitle>
                  <CardDescription>Use the new conversation kernel directly from the UI.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assignee</label>
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={draftAssignedTo}
                        onChange={(e) => setDraftAssignedTo(e.target.value)}
                        className="h-10 min-w-[220px] rounded-md border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">Unassigned</option>
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
                        }, 'Assignee updated')}
                      >
                        Apply assignee
                      </Button>
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
                        }, `Stage moved to ${stage}`)}
                      >
                        {stage}
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Follow-up at</label>
                    <input
                      type="datetime-local"
                      value={draftFollowUp}
                      onChange={(e) => setDraftFollowUp(e.target.value)}
                      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canOperate || saving || !draftFollowUp}
                      onClick={() => void runMutation('/api/conversations/follow-up', {
                        conversation_id: detail.conversation.id,
                        next_follow_up_at: new Date(draftFollowUp).toISOString(),
                        note: draftNote || null,
                      }, 'Follow-up scheduled')}
                    >
                      Set follow-up
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operator note</label>
                    <Textarea
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Write the current deal reality, objection, next step..."
                      rows={5}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!canOperate || saving || !draftNote.trim()}
                        onClick={() => void runMutation('/api/conversations/note', {
                          conversation_id: detail.conversation.id,
                          note: draftNote,
                        }, 'Note saved')}
                      >
                        Save note
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
                          }, 'Conversation reopened')}
                        >
                          Reopen
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Evidence Stack</CardTitle>
                  <CardDescription>Source, links, and sale context in one operator view.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Source summary</div>
                    <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {JSON.stringify(detail.conversation.source_summary ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Primary call</div>
                      {detail.primary_call ? (
                        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {JSON.stringify(detail.primary_call, null, 2)}
                        </pre>
                      ) : (
                        <div className="text-sm text-slate-500">No primary call attached.</div>
                      )}
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Primary session</div>
                      {detail.primary_session ? (
                        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                          {JSON.stringify(detail.primary_session, null, 2)}
                        </pre>
                      ) : (
                        <div className="text-sm text-slate-500">No primary session attached.</div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Links</div>
                      <div className="space-y-2">
                        {detail.links.length === 0 ? (
                          <div className="text-sm text-slate-500">No linked entities.</div>
                        ) : detail.links.map((link) => (
                          <div key={link.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <div className="font-medium text-slate-900">{link.entity_type}</div>
                            <div className="font-mono text-xs text-slate-500">{link.entity_id}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Sales</div>
                      <div className="space-y-2">
                        {detail.sales.length === 0 ? (
                          <div className="text-sm text-slate-500">No linked sales.</div>
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
                  <CardTitle className="text-lg">Timeline</CardTitle>
                  <CardDescription>Immutable conversation event stream.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.timeline.length === 0 ? (
                    <div className="text-sm text-slate-500">No timeline entries yet.</div>
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
