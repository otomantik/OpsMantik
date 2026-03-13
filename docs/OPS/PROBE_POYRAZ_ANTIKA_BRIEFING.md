# OpsMantik Probe — Poyraz Antika (Android / Gemini Briefing)

Poyraz Antika için entegrasyon testi kimlik bilgileri. Android Studio'daki Gemini'ye kopyala-yapıştır yap.

---

## Poyraz Antika Credentials

| Alan | Değer |
|------|-------|
| **siteId** | `b3e9634575df45c390d99d2623ddcde5` |
| **accessToken** | `eyJhbGciOiJFUzI1NiIsImtpZCI6IjY1OWJlYWMwLWM5ZDItNGRkMi1hMWIwLWYxMDcxNjU2NDZkZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2prdHB2ZmJtdW9xcnR1d2JqcHdsLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1MTg2MzM5ZS1kZDY2LTRiN2ItOWFlNS1hZjNhMTU3ZTdhYjgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzczMDc3NjU2LCJpYXQiOjE3NzMwNzQwNTYsImVtYWlsIjoicGxheXdyaWdodC1wcm9vZkBvcHNtYW50aWsubG9jYWwiLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc3MzA3NDA1Nn1dLCJzZXNzaW9uX2lkIjoiNGQ3YzQ5NDgtZDIyMS00ZjAxLThiZGEtZjkwYWQzYjZkYjZiIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.Sk8GuZJKFVR-srnGKePED7LtIC60Czn-JlpIfpnxx6mi-4HTJvTfkx_2geinthazNALAg98opgNwrI1QbO6doQ` |
| **baseUrl** | `https://console.opsmantik.com` |

**Not:** accessToken ~1 saat geçerlidir. Süresi dolduğunda backend'de `npm run probe:token` ile yeni token alın.

---

## Örnek İstekler (Poyraz Antika)

**Register:**
```json
{
  "siteId": "b3e9634575df45c390d99d2623ddcde5",
  "deviceId": "android_device_unique_id",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
}
```

**By-Phone:**
```
GET https://console.opsmantik.com/api/sites/b3e9634575df45c390d99d2623ddcde5/calls/by-phone?phone=%2B905321234567
Authorization: Bearer <accessToken>
```

Tam API sözleşmeleri için: `docs/OPS/PROBE_INTEGRATION_GEMINI_BRIEFING.md`
