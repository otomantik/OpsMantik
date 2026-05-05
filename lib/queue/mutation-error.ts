/** String-key translator (e.g. `tUnsafe` from I18n); avoids `TranslationKey` vs dynamic server messages. */
export type MutationErrorTranslator = (
  key: string,
  params?: Record<string, string | number>
) => string;

export type MutationTelemetryKind =
  | 'queue_action_denied_readonly_total'
  | 'queue_action_conflict_total'
  | 'queue_action_missing_intent_total';

export type ParsedMutationError = {
  status: number;
  code: string | null;
  error: string | null;
  message: string;
  telemetry: MutationTelemetryKind | null;
};

function mapDomainMessage(
  status: number,
  code: string | null,
  fallback: string,
  t: MutationErrorTranslator
): ParsedMutationError {
  if (status === 403 && code === 'READ_ONLY_SCOPE') {
    return {
      status,
      code,
      error: fallback || code,
      message: 'Mudahale yetkiniz yok (salt okunur).',
      telemetry: 'queue_action_denied_readonly_total',
    };
  }
  if (status === 409 && code === 'CONCURRENCY_CONFLICT') {
    return {
      status,
      code,
      error: fallback || code,
      message: 'Kayit baska bir islemde guncellendi, lutfen yenileyin.',
      telemetry: 'queue_action_conflict_total',
    };
  }
  if (status === 400 && code === 'INVALID_VERSION') {
    return {
      status,
      code,
      error: fallback || code,
      message: 'Kayit surumu guncel degil, lutfen yenileyin.',
      telemetry: 'queue_action_conflict_total',
    };
  }
  return {
    status,
    code,
    error: fallback || null,
    message: fallback || t('toast.failedUpdate'),
    telemetry: null,
  };
}

export async function parseMutationError(
  response: Response,
  t: MutationErrorTranslator
): Promise<ParsedMutationError> {
  const payloadUnknown = await response.json().catch(() => ({}));
  const payload =
    payloadUnknown && typeof payloadUnknown === 'object' && !Array.isArray(payloadUnknown)
      ? (payloadUnknown as Record<string, unknown>)
      : {};
  const code = typeof payload.code === 'string' && payload.code.trim() ? payload.code.trim() : null;
  const error = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : null;
  return mapDomainMessage(response.status, code, error ?? response.statusText, t);
}
