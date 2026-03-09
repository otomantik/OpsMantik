# Site-Specific OCI Snapshots

Bu klasordeki script'ler repo icindeki canonical kaynak degildir.

- Canonical kaynak: `scripts/google-ads-oci/GoogleAdsScript.js`
- Bu klasor: site-specific snapshot/deploy kopyalari
- Degisiklik gerekiyorsa once canonical script guncellenmeli, sonra bu snapshot'lar yeniden uretilmeli veya kopyalanmalidir.

Legacy OCI endpoint'leri (`/api/oci/export`, `/api/oci/export-batch`) emekliye ayrilmistir. Aktif script kontrati `google-ads-export -> ack/ack-failed -> verify` akisidir.
