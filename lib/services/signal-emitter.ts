/**
 * OpsMantik Signal Emitter
 *
 * Sistemde bir durum değiştiğinde (örn: form gönderildi, mühür beklemede, toplantı planlandı)
 * çağrılır. Orijinal veriyi bozmadan, Google Ads Observation/Optimization için yeni bir
 * 'Sinyal Olayı' yaratır.
 *
 * Sinyaller marketing_signals tablosuna append-only yazılır.
 * MizanMantik: baseValue + clickDate + signalDate → time-decayed conversion_value.
 */

import { adminClient } from '@/lib/supabase/admin';
import { calculateDecayedValue } from '@/lib/utils/mizan-mantik';

export type SignalType = 'INTENT_CAPTURED' | 'SEAL_PENDING' | 'MEETING_BOOKED';

export interface EmitSignalParams {
  siteId: string;
  callId?: string | null;
  signalType: SignalType;
  conversionName: string; // Örn: 'OpsMantik_Qualified', 'OpsMantik_Lead'
  /** MizanMantik: base value (e.g. AOV) for time-decay. */
  baseValue?: number;
  /** MizanMantik: when the user clicked the ad. */
  clickDate?: Date;
  /** MizanMantik: when the signal occurred (default: now). */
  signalDate?: Date;
}

/**
 * Sinyal yayınla — marketing_signals tablosuna append-only kayıt ekler.
 * Google Ads Observation/Optimization sinyalleri için zaman damgalı geçmiş oluşturur.
 * When baseValue, clickDate, signalDate are provided, conversion_value is computed via MizanMantik.
 */
export async function emitSignal(params: EmitSignalParams) {
  const { siteId, callId, signalType, conversionName, baseValue, clickDate, signalDate } = params;

  const now = new Date();
  const sigDate = signalDate ?? now;

  let conversionValue: number | null = null;
  if (
    typeof baseValue === 'number' &&
    Number.isFinite(baseValue) &&
    clickDate instanceof Date &&
    !Number.isNaN(clickDate.getTime())
  ) {
    conversionValue = calculateDecayedValue(baseValue, clickDate, sigDate);
  }

  const insertPayload: Record<string, unknown> = {
    site_id: siteId,
    call_id: callId ?? null,
    signal_type: signalType,
    google_conversion_name: conversionName,
    google_conversion_time: sigDate.toISOString(),
    dispatch_status: 'PENDING',
  };
  if (conversionValue !== null) {
    insertPayload.conversion_value = conversionValue;
  }

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error) {
    console.error('[Signal Emitter] Sinyal kayıt hatası:', error.message);
    throw new Error('Sinyal matrise yazılamadı.');
  }

  return { id: data?.id, signalType, conversionName };
}
