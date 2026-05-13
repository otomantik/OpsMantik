/**
 * DEPRECATED — bu dosya artık taahhüt altında güncellenmiyor ve içinde sızdırılmış
 * kimlik bilgisi bulunmadığından doğrudan kopyalanıp kullanılmamalıdır.
 *
 * Muratcan Akü için tarihsel fork (**repodan kaldırıldı**; git geçmişi):
 *   Yeni kurulum: `scripts/google-ads-oci/GoogleAdsScriptUniversal.js`.
 *   • OPSMANTIK_RUN_MODE = 'peek'  → kuyruk ön izleme (Google’a yükleme yok)
 *   • OPSMANTIK_RUN_MODE = 'sync' → yükleme + ACK (Tecrubeli-grade CSV şeması)
 *
 * Kimlikleri doldurmak için (repo’ya key yazmadan):
 *   node scripts/get-oci-credentials.mjs Muratcan
 *
 * Güvenlik: Eskiden bu dosyada düz metin anahtar vardı — rotasyon yaptınızdan emin olun.
 */

function main() {
  Logger.log(
    '[OpsMantik] Bu deploy snapshot emekli. GoogleAdsScriptUniversal.js kullanın (Muratcan tarihsel fork kaldırıldı; donmuş satır: tests/fixtures/google-ads-oci/PR9H4C_MURATCAN_MARK_DEFAULT_SNAPSHOT.js).'
  );
}
