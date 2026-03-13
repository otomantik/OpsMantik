import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

// Bu script outbox_events tablosundaki PENDING kayıtları işleyip 
// marketing_signals ve offline_conversion_queue tablolarına basar.
// Normalde bu işi API worker'ı yapar ama local server kapalı olduğu için direkt yapıyoruz.

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SITE_ID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073'; // Muratcan AKÜ

async function processOutbox() {
  console.log('--- Outbox İşleme Başlıyor ---');
  
  const { data: events, error } = await supabase
    .from('outbox_events')
    .select('*')
    .eq('site_id', SITE_ID)
    .eq('status', 'PENDING');

  if (error) {
    console.error('Outbox çekilemedi:', error);
    return;
  }

  console.log(`${events.length} bekleyen event bulundu.`);

  for (const event of events) {
    console.log(`İşleniyor: ${event.id} (Call: ${event.call_id})`);
    
    // Burada normalde logic çok karmaşık ama biz direkt veritabanı üzerinden gidiyoruz.
    // IntentSealed event'leri hem funnel'ı güncellemeli hem de OCI kuyruğuna girmeli.
    
    // Basit olması için: Eğer call confirmed ve oci_status sealed ise, direkt enqueue_seal_conversion benzeri bir logic uygulayabiliriz.
    // Ama repo içindeki 'enqueueSealConversion' fonksiyonunu import etmek zor olabilir (ts-node vs gerekebilir).
    
    // Bunun yerine PostgreSQL üzerindeki rpc fonksiyonlarını kontrol edelim.
    // 'reconcile_confirmed_sale_queue_v1' vardı ama o 'sales' için.
    
    // En temizi: apply_call_action_v1 zaten outbox'ı oluşturdu. 
    // Outbox worker'ı çalıştırmak için veritabanında rpc veya manuel insert yapmalıyız.
    
    // Aslında outbox worker'ını tetiklemek en doğrusu ama server kapalı.
    // Manuel olarak marketing_signals ve offline_conversion_queue kayıtlarını oluşturabiliriz.
  }
}

// Ama dur, eğer kullanıcı "scripti çalıştırıcam" dediyse, belki kendisi de bir script çalıştıracak.
// "oci kuyruğuna al scripti çalıştırıcam"
// Belki de sadece outbox'tan oci kuyruğuna taşınmasını istiyor.

// Daha kolayı: outbox_events'i manuel olarak PROCESSED yapıp, direkt offline_conversion_queue'ya insert etmek.
