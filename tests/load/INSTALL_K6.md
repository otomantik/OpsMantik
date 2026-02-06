# k6 Kurulumu (Windows)

k6 bir Node.js paketi değil, standalone binary. İki yol:

## Yöntem 1: Chocolatey (önerilen)

**PowerShell'i Admin olarak aç:**
```powershell
choco install k6
```

Sonra test:
```powershell
k6 version
```

Kurulum sonrası:
```powershell
cd C:\Users\serka\OneDrive\Desktop\project\opsmantik-v1
npm run load:smoke
```

## Yöntem 2: Manuel İndirme

1) https://dl.k6.io/msi/k6-latest-amd64.msi indir
2) MSI installer'ı çalıştır
3) Yeni terminal aç (PATH yenilenmesi için)
4) Test: `k6 version`

## Yöntem 3: Docker (kurulum gerektirmez)

```powershell
docker run --rm -i grafana/k6 run - < tests/load/smoke-load.js
```

Ya da npm script:
```powershell
npm run load:docker
```

## Kullanım (k6 kuruluysa)

**Local'e karşı (dev server):**
```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run load:smoke
```

**Production'a karşı (dikkatli):**
```powershell
$env:BASE_URL="https://console.opsmantik.com"
$env:TEST_SITE_ID="test_site_5186339e"
k6 run tests/load/smoke-load.js
```

## Beklenen Çıktı

```
✓ status is 200                  ........ 100.00% ✓ 8432      ✗ 0     
✓ response has ok field          ........ 100.00% ✓ 8432      ✗ 0     
✓ response time < 1s             ........ 100.00% ✓ 8432      ✗ 0     

http_req_duration..............: avg=125ms  p(95)=287ms  ✅
http_req_failed................: 0.00%   ✓ 0         ✗ 8432  ✅
```

**Başarı:** Tüm checkler ✓, p95 < 500ms, error rate < 1%
