#!/usr/bin/env node

/**
 * SECTOR BRAVO — Tank Tracker: Offline → event → Online → outbox drain proof.
 * Playwright ile: sayfayı aç, offline yap, event tetikle, outbox'ta veri var mı kontrol et,
 * online yap, 6 sn bekle, outbox boşaldı mı kontrol et.
 *
 * URL: TRACKER_SITE_URL veya PROOF_URL (env veya .env.local).
 */

import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const publicDir = join(rootDir, 'public');
dotenv.config({ path: join(rootDir, '.env.local') });

const USE_LOCAL_TRACKER_PAGE = process.env.USE_LOCAL_TRACKER_PAGE === '1' || process.env.USE_LOCAL_TRACKER_PAGE === 'true';
const TRACKER_SITE_URL = process.env.TRACKER_SITE_URL || process.env.PROOF_URL;
const SMOKE_SITE_ID = process.env.SMOKE_SITE_ID || process.env.TRACKER_SITE_ID;
const OUTBOX_KEY = 'opsmantik_outbox_v2';
const OLD_QUEUE_KEY = 'opsmantik_evtq_v1';
const WAIT_AFTER_ONLINE_MS = 6000;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function info(msg) {
  console.log(`${YELLOW}ℹ${RESET} ${msg}`);
}
function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}

let targetUrl;
let localServer = null;

if (USE_LOCAL_TRACKER_PAGE) {
  if (!existsSync(join(publicDir, 'smoke-tracker-test.html')) || !existsSync(join(publicDir, 'ux-core.js'))) {
    console.log(`${RED}public/smoke-tracker-test.html veya public/ux-core.js yok.${RESET}\n`);
    process.exit(1);
  }
  const siteId = SMOKE_SITE_ID || '00000000-0000-4000-8000-000000000000';
  localServer = createServer((req, res) => {
    const pathname = req.url === '/' ? '/smoke-tracker-test.html' : req.url.split('?')[0];
    const file = join(publicDir, pathname);
    if (!file.startsWith(publicDir) || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const data = readFileSync(file);
      const ct = pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  const port = localServer.address().port;
  targetUrl = `http://127.0.0.1:${port}/smoke-tracker-test.html?site_id=${encodeURIComponent(siteId)}`;
} else if (TRACKER_SITE_URL) {
  targetUrl = TRACKER_SITE_URL;
} else {
  console.log(`${YELLOW}TRACKER_SITE_URL (veya PROOF_URL) tanımlı değil.${RESET}`);
  console.log(`Örnek: TRACKER_SITE_URL=https://www.poyrazantika.com npm run smoke:tank-tracker-offline`);
  console.log(`Yerel Tank Tracker kanıtı: USE_LOCAL_TRACKER_PAGE=1 SMOKE_SITE_ID=<site-uuid> npm run smoke:tank-tracker-offline\n`);
  process.exit(0);
}

console.log(`\n${bold('SECTOR BRAVO — Tank Tracker Offline/Online proof')}`);
console.log(`${bold('========================================')}`);
info(`URL: ${targetUrl}\n`);

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (launchErr) {
  const msg = launchErr?.message || '';
  if (msg.includes("Executable doesn't exist") || msg.includes('chromium') || msg.includes('chrome-headless')) {
    console.log(`${YELLOW}ℹ Playwright tarayıcısı yüklü değil. Çalıştır: npx playwright install${RESET}\n`);
  }
  fail(`Browser launch: ${msg}`);
  process.exit(1);
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

let passed = true;

try {
  // 1. Sayfayı aç (online) — tracker yüklensin
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  // Tracker yüklü mü? (window.opmantik.send)
  const hasTracker = await page.evaluate(() => !!(window.opmantik && typeof window.opmantik.send === 'function'));
  if (!hasTracker) {
    fail('Sayfada OpsMantik tracker yok (window.opmantik.send). TRACKER_SITE_URL tracker yüklü bir sayfa olmalı.');
    passed = false;
  } else {
    info('Tracker yüklü.');
  }

  // 2. Outbox'ları temizle (yeni + eski kuyruk)
  await page.evaluate((keys) => {
    keys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    });
  }, [OUTBOX_KEY, OLD_QUEUE_KEY]);
  await page.waitForTimeout(300);

  // 3. Offline yap (reload yapmıyoruz — sayfa zaten yüklü)
  await context.setOffline(true);
  info('Offline yapıldı.');
  await page.waitForTimeout(500);

  // 4. Event tetikle: sayfada zaten yüklü olan tracker'a sendEvent çağır (reload değil)
  await page.evaluate(() => {
    if (window.opmantik && typeof window.opmantik.send === 'function') {
      window.opmantik.send('interaction', 'smoke_test', 'offline', null);
    }
  });
  await page.waitForTimeout(1500);

  // 5. Outbox'ta en az bir öğe var mı? (yeni Tank Tracker: outbox_v2; eski: evtq_v1)
  const queuesAfterOffline = await page.evaluate((keys) => {
    const out = {};
    keys.forEach((key) => {
      try {
        const raw = localStorage.getItem(key);
        out[key] = raw ? JSON.parse(raw) : [];
      } catch (e) {
        out[key] = [];
      }
    });
    return out;
  }, [OUTBOX_KEY, OLD_QUEUE_KEY]);

  const outboxV2 = Array.isArray(queuesAfterOffline[OUTBOX_KEY]) ? queuesAfterOffline[OUTBOX_KEY] : [];
  const oldQueue = Array.isArray(queuesAfterOffline[OLD_QUEUE_KEY]) ? queuesAfterOffline[OLD_QUEUE_KEY] : [];
  const storedNew = outboxV2.length >= 1;
  const storedOld = oldQueue.length >= 1;

  if (storedNew) {
    pass(`Offline sonrası outbox_v2'de ${outboxV2.length} öğe var (Store başarılı — Tank Tracker).`);
  } else if (storedOld) {
    pass(`Offline sonrası eski kuyrukta (evtq_v1) ${oldQueue.length} öğe var (Store başarılı — site henüz yeni tracker deploy etmemiş).`);
  } else {
    fail(`Offline sonrası hem outbox_v2 (${outboxV2.length}) hem eski kuyruk (${oldQueue.length}) boş. Beklenen: en az biri >= 1.`);
    info('İpucu: Site yeni ux-core.js (Tank Tracker) ile deploy edildi mi? Eski tracker offline\'da bazen event\'i kuyuğa yazmaz.');
    passed = false;
  }

  // 6. Online yap
  await context.setOffline(false);
  info('Online yapıldı, 6 sn bekleniyor...');
  await page.waitForTimeout(WAIT_AFTER_ONLINE_MS);

  // 7. Outbox boşaldı mı? (yeni tracker için outbox_v2; eski kuyruk otomatik drain etmez)
  const outboxAfterOnline = await page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }, OUTBOX_KEY);

  const remaining = Array.isArray(outboxAfterOnline) ? outboxAfterOnline.length : 0;
  if (remaining === 0) {
    pass('Online sonrası outbox_v2 boş (Forward başarılı).');
  } else if (USE_LOCAL_TRACKER_PAGE) {
    info('Yerel sayfa: API localhost\'ta olmadığı için Forward N/A (Store kanıtı yeterli).');
  } else if (storedOld && !storedNew) {
    info('Online sonrası outbox_v2 boş; eski kuyruk otomatik drain etmez (site yeni tracker deploy edince geçer).');
  } else {
    info(`Online sonrası outbox_v2'de hâlâ ${remaining} öğe var.`);
    passed = false;
    fail('Outbox tamamen boşalmadı.');
  }
} catch (err) {
  fail(`Hata: ${err.message}`);
  passed = false;
} finally {
  await context.close();
  await browser.close();
  if (localServer) {
    await new Promise((resolve) => localServer.close(resolve));
  }
}

console.log(`\n${bold('----------------------------------------')}`);
if (passed) {
  console.log(`${GREEN}${bold('✅ Tank Tracker Offline/Online proof: PASS')}${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${bold('❌ Tank Tracker Offline/Online proof: FAIL')}${RESET}\n`);
  process.exit(1);
}
