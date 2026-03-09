# Chatbot Generic Phase Entrypoints

Bu not, telefon/WhatsApp/form cekirdegi kilitlendikten sonra chatbot yakalamanin
nereden ve nasil acilacagini netlestirmek icin bir referans birakir.

## Hedef

Ilk chatbot fazi vendor-bazli degil, generic ortak katman olmalidir:

- tracker tarafinda `chat_open` / `chat_start`
- backend tarafinda mevcut `event -> intent` akisi
- ilk fazda `intent_action = 'other'`

Bu sayede Jivo, Joinchat, Tawk, Crisp, Intercom gibi vendorlar icin ayri ayri
sert entegrasyon yapmadan once ortak event semantigi oturur.

## Gecis Noktalari

### Frontend Tracker

Ana giris noktasi:

- `lib/tracker/tracker.js`

Burada acilacak katman:

- widget acilma sinyali
- ilk mesaj / baslangic sinyali
- vendor/source metadata

Onerilen eventler:

- `event_category = 'conversion'`
- `event_action = 'chat_open'`
- `event_action = 'chat_start'`

Onerilen metadata:

- `intent_action = 'other'`
- `intent_target = 'chat:<vendor-or-surface>'`
- `intent_source = '<vendor>'`
- `intent_page_url`

### Backend Event Bridge

Ana giris noktasi:

- `lib/ingest/process-sync-event.ts`
- `lib/services/intent-service.ts`

Burada yapilacak is:

- `chat_open` ve `chat_start` eventlerini intent-worthy sinyal olarak tanimlamak
- ilk fazda bunlari `phone` veya `whatsapp` gibi davranmaya zorlamamak
- session-based tek kart mantigini bozmayacak sekilde `other` olarak akitmak

## Guvenlik Kurali

Su ayrim korunmali:

- Gercek `tel:` veya WhatsApp cikisi varsa mevcut `call-event` hattina girer
- Sadece chat widget acildiysa `sync` hattina girer

Boylece chatbot yuzeyi telefon/WhatsApp kontratini bozamaz.

## Faz-2 Hazirlik Kriteri

Chatbot generic fazina ancak su kosullarda gec:

- telefon canli proof temiz
- WhatsApp/joinchat canli proof temiz
- form yuzeyi tracker + intent kontrati ile net
- release gate ve smoke testler temiz
- cekirdek 24 saat yeni P0 uretmemis
