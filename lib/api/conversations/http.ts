import { NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    extra ? { error: message, ...extra } : { error: message },
    { status, headers: getBuildInfoHeaders() }
  );
}

export function mapConversationRpcError(
  error: { message?: string; code?: string } | null,
  fallbackMessage = 'Internal server error'
) {
  const message = error?.message ?? '';

  if (message === 'access_denied') return jsonError('Forbidden', 403);
  if (message === 'conversation_not_found') return jsonError('Conversation not found', 404);
  if (message === 'site_id_required') return jsonError('site_id is required', 400);
  if (message === 'invalid_bucket') return jsonError('bucket must be one of: active, all, overdue, today, unassigned', 400);
  if (message === 'invalid_stage') return jsonError('Invalid stage', 400, { code: 'INVALID_STAGE' });
  if (message === 'note_required') return jsonError('note is required', 400);
  if (message === 'follow_up_required') return jsonError('next_follow_up_at is required', 400);
  if (message === 'follow_up_before_create') {
    return jsonError('next_follow_up_at cannot be earlier than conversation creation', 409, {
      code: 'FOLLOW_UP_BEFORE_CREATE',
    });
  }
  if (message === 'conversation_not_actionable') {
    return jsonError('Conversation is terminal and cannot be changed by this route', 409, {
      code: 'CONVERSATION_NOT_ACTIONABLE',
    });
  }
  if (message === 'conversation_not_reopenable') {
    return jsonError('Conversation is already open', 409, { code: 'CONVERSATION_NOT_REOPENABLE' });
  }
  if (message === 'assignee_site_mismatch') {
    return jsonError('assigned_to must belong to this conversation site', 400, { code: 'ASSIGNEE_SITE_MISMATCH' });
  }
  if (message === 'invalid_entity_type') {
    return jsonError('entity_type must be one of: session, call, event', 400);
  }
  if (message === 'entity_site_mismatch') {
    return jsonError('Entity not found or does not belong to this conversation site', 400, {
      code: 'ENTITY_SITE_MISMATCH',
    });
  }

  return jsonError(fallbackMessage, 500, error?.code ? { code: error.code } : undefined);
}
