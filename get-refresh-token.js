/**
 * OpsMantik - Refresh Token Üretici
 * Kurulum: npm install googleapis open server-destroy
 * Çalıştırma: node get-refresh-token.js
 *
 * Port 3001 kullanır; Next.js (3000) çalışırken de çalıştırabilirsiniz.
 * Google Cloud Console'da "Authorized redirect URIs"e http://localhost:3001/oauth2callback ekleyin.
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const openModule = require('open');
const open = typeof openModule === 'function' ? openModule : openModule.default;
const destroyer = require('server-destroy');

const PORT = parseInt(process.env.OAUTH_LOCAL_PORT || '3001', 10);

// --- .env.local veya ortam degiskenleri: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET ---
const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
// Google Cloud Console'da "Authorized redirect URIs" listesine eklediğiniz adresle BİREBİR aynı olmalı.
const REDIRECT_URI = process.env.GOOGLE_ADS_REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;

// --- Ayarlar ---
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = ['https://www.googleapis.com/auth/adwords'];

// --- Geçici Sunucu ---
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/oauth2callback')) {
    const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
    const code = qs.get('code');
    const error = qs.get('error');

    if (error || !code) {
      res.end('Hata: Yetkilendirme iptal edildi veya kod alinamadi. Lutfen tekrar deneyin.');
      server.destroy();
      console.error('\nHata:', error || 'Onay kodu gelmedi.');
      process.exit(1);
    }

    res.end('Giris basarili! Terminale donup token\'inizi alabilirsiniz. Bu sayfayi kapatabilirsiniz.');
    server.destroy(); // Sunucuyu kapat

    console.log('\n>>> Onay Kodu Alındı!');

    // Kodu Token ile Takas Et
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n=========================================');
    console.log('✅ REFRESH TOKENINIZ:');
    console.log('=========================================');
    console.log(tokens.refresh_token);
    console.log('=========================================\n');
    process.exit(0);
  }
});

destroyer(server);

server.listen(PORT, () => {
  const PLACEHOLDER_ID = 'BURAYA_CLIENT_ID_YAZ';
  const PLACEHOLDER_SECRET = 'SENIN_CLIENT_SECRET_BURAYA';
  if (CLIENT_ID === PLACEHOLDER_ID || CLIENT_SECRET === PLACEHOLDER_SECRET) {
    console.error('Hata: CLIENT_ID ve CLIENT_SECRET değerlerini get-refresh-token.js içinde doldurun veya GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET env ile verin.');
    process.exit(1);
  }

  // Yetkilendirme URL'ini oluştur
  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Refresh token vermesi için ŞART
    prompt: 'consent',      // Her seferinde sorması için ŞART
    scope: SCOPES,
  });

  console.log('>>> Tarayıcı açılıyor, lütfen Test Hesabını yöneten mail ile giriş yap...');
  open(authorizeUrl);
});
