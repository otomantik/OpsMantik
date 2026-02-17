# Bu site icin Google Ads credential'larini provider_credentials tablosuna ekler (vault ile sifreli).
# 1) .env.local'a OPSMANTIK_VAULT_KEY eklendi mi kontrol et; dev server'i yeniden baslat.
# 2) Asagidaki degiskenleri doldur: $secret (CRON_SECRET), $refreshToken (.env.local GOOGLE_ADS_REFRESH_TOKEN),
#    client_id, client_secret, developer_token (Google Cloud Console), customer_id, login_customer_id, conversion_action_resource_name.
# 3) Calistir: .\scripts\seed-google-ads-credentials.ps1

$siteId       = "YOUR_SITE_ID"
$secret       = $env:CRON_SECRET  # veya "YOUR_CRON_SECRET"
$refreshToken = $env:GOOGLE_ADS_REFRESH_TOKEN  # veya "YOUR_REFRESH_TOKEN"

$body = @{
  site_id      = $siteId
  provider_key = "google_ads"
  credentials = @{
    customer_id                     = "XXX-XXX-XXXX"
    developer_token                 = "YOUR_DEVELOPER_TOKEN"
    client_id                       = $env:GOOGLE_ADS_CLIENT_ID
    client_secret                   = $env:GOOGLE_ADS_CLIENT_SECRET
    refresh_token                   = $refreshToken
    login_customer_id               = "XXX-XXX-XXXX"
    conversion_action_resource_name = "customers/XXXX/conversionActions/XXXX"
  }
} | ConvertTo-Json -Depth 5

try {
  $response = Invoke-WebRequest -Uri "http://localhost:3000/api/cron/providers/seed-credentials" -Method POST `
    -UseBasicParsing `
    -Headers @{ "Authorization" = "Bearer $secret"; "Content-Type" = "application/json" } `
    -Body $body
  Write-Host $response.Content
} catch {
  Write-Host "Hata:" $_.Exception.Message
  if ($_.Exception.Response) { $_.Exception.Response }
}
