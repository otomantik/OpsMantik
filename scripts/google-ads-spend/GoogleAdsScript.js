/**
 * OpsMantik — Real-Time Daily Ad Spend Webhook (V2)
 * Sadece BUGÜNÜN (TODAY) verilerini çeker ve OpsMantik'e gönderir.
 * Saatlik tetikleyici ile çalıştır; her seferinde bugünkü güncel harcama upsert edilir.
 */

function main() {
  // === AYARLAR (Kendi ortamına göre doldur) ===
  var WEBHOOK_URL = "https://console.opsmantik.com/api/webhooks/google-spend";
  var SECRET_TOKEN = "BURAYA_GIZLI_SIFRE_GELECEK";  // Vercel'deki GOOGLE_SPEND_WEBHOOK_SECRET ile AYNI
  var SITE_ID = "b1264552-c859-40cb-a3fb-0ba057afd070";  // Eslamed (sites tablosu UUID)
  // ============================================

  var secret = (SECRET_TOKEN && SECRET_TOKEN.trim()) ? SECRET_TOKEN.trim() : "";
  if (secret === "" || secret === "BURAYA_GIZLI_SIFRE_GELECEK") {
    Logger.log("HATA: SECRET_TOKEN değerini doldurun (Vercel'deki GOOGLE_SPEND_WEBHOOK_SECRET ile aynı olmalı).");
    return;
  }

  var query =
    "SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions " +
    "FROM campaign " +
    "WHERE segments.date DURING TODAY AND metrics.cost_micros > 0";

  var payloadData = [];

  try {
    var report = AdsApp.search(query);
    var todayStr = Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), "yyyy-MM-dd");

    while (report.hasNext()) {
      var row = report.next();
      var costMicros = parseInt(row.metrics.costMicros, 10) || 0;
      var costActual = costMicros / 1000000;

      payloadData.push({
        campaignId: String(row.campaign.id),
        campaignName: String(row.campaign.name || "").trim(),
        cost: costActual,
        clicks: parseInt(row.metrics.clicks, 10) || 0,
        impressions: parseInt(row.metrics.impressions, 10) || 0,
        date: todayStr
      });
    }
  } catch (e) {
    Logger.log("Sorgu hatası: " + e.toString());
    return;
  }

  if (payloadData.length === 0) {
    Logger.log("Bugün henüz hiç harcama yok. Gönderim iptal.");
    return;
  }

  var payload = JSON.stringify({ site_id: SITE_ID, data: payloadData });
  var options = {
    method: "post",
    muteHttpExceptions: true,
    contentType: "application/json",
    payload: payload,
    headers: {
      "x-opsmantik-webhook-secret": secret
    }
  };

  try {
    var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 200) {
      Logger.log("BAŞARILI! " + payloadData.length + " kampanyanın harcama verisi OpsMantik'e eklendi.");
    } else {
      Logger.log("WEBHOOK HATASI! HTTP " + code + " - " + body);
    }
  } catch (e) {
    Logger.log("AĞ HATASI: Webhook'a ulaşılamadı. Detay: " + e.toString());
  }
}
