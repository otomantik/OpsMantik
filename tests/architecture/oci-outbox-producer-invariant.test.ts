/**
 * Kanıt: `calls.status` için OCI export üreten her HTTP yüzü, başarılı RPC sonrasında
 * `enqueuePanelStageOciOutbox` + `notifyOutboxPending` zincirini çağırır.
 *
 * RPC ailesi (`apply_call_action_v2` / `apply_call_action_with_review_v1`) tek başına
 * `outbox_events` yazmaz; bildirimin çalışması için önce enqueue şart.
 *
 * Not: Varsayılan olarak `intent` statüsü OCI stage map’ine girmez; isteğe bağlı
 * `OCI_INTENT_PANEL_PRECURSOR_CONTACTED_ENABLED` ile panel-only “intent + Ads click → contacted”
 * öncü outbox üretilir. Click eligibility `resolveOciClickAttribution` ile worker’daki
 * `getPrimarySource` hizalıdır (session veya call satırı).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const API_ROOT = join(ROOT, 'app', 'api');

function collectRouteTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) collectRouteTsFiles(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}

const OCI_CALLOSMUTATORS: Array<{ path: string; rpcMustInclude: string; label: string }> = [
  {
    label: 'panel stage (kart skoru)',
    path: join(ROOT, 'app/api/intents/[id]/stage/route.ts'),
    rpcMustInclude: "adminClient.rpc('apply_call_action_with_review_v1'",
  },
  {
    label: 'intent status (junk / restore fallback)',
    path: join(ROOT, 'app/api/intents/[id]/status/route.ts'),
    rpcMustInclude: "adminClient.rpc('apply_call_action_with_review_v1'",
  },
  {
    label: 'seal / won (Casino probe + dashboard)',
    path: join(ROOT, 'app/api/calls/[id]/seal/route.ts'),
    rpcMustInclude: "adminClient.rpc('apply_call_action_v2'",
  },
];

function assertRouteEnqueuesOutboxAfterRpc(fullPath: string, label: string, rpcSubstring: string) {
  assert.ok(existsSync(fullPath), `${label}: dosya bekleniyor ${fullPath}`);
  const src = readFileSync(fullPath, 'utf8');
  assert.ok(src.includes(rpcSubstring), `${label}: mutasyon RPC gerekli`);
  assert.ok(
    src.includes('enqueuePanelStageOciOutbox'),
    `${label}: RPC sonrası enqueuePanelStageOciOutbox (IntentSealed outbox)`
  );
  assert.ok(src.includes('notifyOutboxPending'), `${label}: QStash/cron için notifyOutboxPending`);
}

for (const route of OCI_CALLOSMUTATORS) {
  test(`OCI outbox producer: ${route.label}`, () => {
    assertRouteEnqueuesOutboxAfterRpc(route.path, route.label, route.rpcMustInclude);
  });
}

test('app/api: call-action RPC sadece bilinen üç route dosyasında (yeni yüz = test kırılır)', () => {
  const routeFiles = collectRouteTsFiles(API_ROOT).sort();
  const rpcHits = routeFiles.filter((abs) => {
    const src = readFileSync(abs, 'utf8');
    return (
      src.includes("adminClient.rpc('apply_call_action_v2'") ||
      src.includes("adminClient.rpc('apply_call_action_with_review_v1'")
    );
  });
  const rel = rpcHits.map((p) => relative(ROOT, p).replaceAll('\\', '/')).sort();

  const expected = OCI_CALLOSMUTATORS.map((r) => relative(ROOT, r.path).replaceAll('\\', '/')).sort();
  assert.deepStrictEqual(rel, expected, `Beklenmeyen call-action yüzü. Liste: ${JSON.stringify(rel)}
Yeni yüz eklediysen: enqueuePanelStageOciOutbox + notifyOutboxPending ekle ve OCI_CALLOSMUTATORS + expected'i güncelle.`);
});
