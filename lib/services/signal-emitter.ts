/**
 * OpsMantik Signal Emitter
 *
 * Sistemde bir durum değiştiğinde (örn: form gönderildi, mühür beklemede, toplantı planlandı)
 * çağrılır. Orijinal veriyi bozmadan, Google Ads Observation/Optimization için yeni bir
 * 'Sinyal Olayı' yaratır.
 *
 * Sinyaller marketing_signals tablosuna append-only yazılır.
 */

import { adminClient } from '@/lib/supabase/admin';

export type SignalType = 'INTENT_CAPTURED' | 'SEAL_PENDING' | 'MEETING_BOOKED';

export interface EmitSignalParams {
  siteId: string;
  callId?: string | null;
  signalType: SignalType;
  conversionName: string; // Örn: 'OpsMantik_Qualified', 'OpsMantik_Lead'
}

/**
 * Sinyal yayınla — marketing_signals tablosuna append-only kayıt ekler.
 * Google Ads Observation/Optimization sinyalleri için zaman damgalı geçmiş oluşturur.
 */
export async function emitSignal(params: EmitSignalParams) {
  const { siteId, callId, signalType, conversionName } = params;

  const { data, error } = await adminClient
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId ?? null,
      signal_type: signalType,
      google_conversion_name: conversionName,
      google_conversion_time: new Date().toISOString(),
      dispatch_status: 'PENDING',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Signal Emitter] Sinyal kayıt hatası:', error.message);
    throw new Error('Sinyal matrise yazılamadı.');
  }

  return { id: data?.id, signalType, conversionName };
}
