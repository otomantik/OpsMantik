# Çöp (Junk) akışı – analiz ve debug

## Panel butonları

| Buton | Anlam | API | Çalışıyor? |
|-------|--------|-----|------------|
| **Mühür / Seal** | Onayla, dönüşüme gönder | `POST /api/calls/[id]/seal` | Evet |
| **Görüşüldü (60/80)** | Görüşüldü / Teklif | `POST /api/calls/[id]/seal` (aynı seal API) | Evet |
| **Çöp / Junk** | Geçersiz, listeden çıkar | `POST /api/intents/[id]/status` body `{ status: 'junk' }` | Sorun burada |

Çöp = nabız (pulse) yok: doğru. Junk intent’ler OCI’a / dönüşüm etkinliğine **gönderilmez**; sadece kuyruktan düşer. Sorun, çöpün **veritabanına yazılmaması** veya **listeden tekrar gelmesi**.

## Akış (çöp tıklanınca)

1. **UI:** Kuyruk kartında “Çöp” veya mühür modalında “Çöp” → `handleJunk` / `onSealJunk`
2. **Hook:** `useIntentQualification.qualify({ score: 0, status: 'junk' })` → `fetch('/api/intents/${intentId}/status', { method: 'POST', body: { status: 'junk' }, credentials: 'include' })`
3. **API:** `app/api/intents/[id]/status/route.ts`
   - Call bulunur (adminClient), site erişimi doğrulanır
   - **adminClient.rpc('apply_call_action_v1', { p_call_id, p_action_type: 'junk', p_actor_type: 'system', p_actor_id: user.id })**
   - RLS bypass (service_role ile çağrı)
4. **DB:** `apply_call_action_v1` → `UPDATE calls SET status = 'junk' WHERE id = p_call_id` + audit
5. **UI:** Başarıda `onQualified()` → `fetchUnscoredIntents()` (get_recent_intents_lite_v1). Junk satır ve aynı session artık listede **gelmez** (migration 20261002000001).

## Yapılan düzeltmeler

- Status API artık **adminClient** ile RPC çağırıyor (RLS / member role engeli kalktı).
- RPC başarılı ama **satır dönmezse** API **500** dönüyor; kullanıcı “Update did not persist; please retry.” görür, kart yanlışlıkla silinmez.
- Junk/undo fetch’e **credentials: 'include'** eklendi.

## Hâlâ çalışmıyorsa kontrol listesi

1. **Canlıda doğru kod var mı?**  
   Vercel’da son deploy’un bu commit’i içerdiğini kontrol et (status route’ta `adminClient.rpc` ve 500 dönüşü).

2. **Network:**  
   Çöp’e tıklayınca F12 → Network → `intents/.../status` isteği:
   - **200 + body’de `call.status === 'junk'`** → API ve DB tamam; liste refetch’te gelmiyorsa lite RPC veya client filtre.
   - **500** → Sunucu log’unda `intent status update failed` veya `returned no row` var mı bak.
   - **403/404** → Erişim / call id yanlış.

3. **Supabase migration’lar:**  
   `20261002000001_junk_stays_and_session_hidden.sql` uygulandı mı? (Aynı session’da junk varsa o session kuyrukta görünmez.)

4. **Sync geri yazıyor mu?**  
   Aynı session tekrar tıklanırsa `ensure_session_intent_v1` çağrılır; migration’da junk/cancelled **korunuyor** (status aynen bırakılıyor). Migration yoksa junk tekrar intent’e dönebilir.

## Özet

- **Görüşüldü / Mühür** → `/api/calls/[id]/seal` → dönüşüm etkinliği (nabız) var.
- **Çöp** → `/api/intents/[id]/status` → sadece kuyruktan düşer, nabız yok; ama **yazılması** bu API’ye bağlı.
- Çöp çalışmıyorsa: Network’te status isteğine bak, 500 ise log’a bak, migration’ları ve canlı kodu doğrula.
