import { afterEach, test, expect, vi } from 'vitest';

import { WatchtowerService } from '@/lib/services/watchtower';
import { TelegramService } from '@/lib/services/telegram-service';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_WEBHOOK_KIND;
  delete process.env.ALERT_WEBHOOK_TIMEOUT_MS;
});

test('WatchtowerService.runDiagnostics: ok when sessions + gclid are present', async () => {
  vi.spyOn(WatchtowerService, 'checkSessionVitality').mockResolvedValue(10);
  vi.spyOn(WatchtowerService, 'checkAttributionLiveness').mockResolvedValue(3);
  const tg = vi.spyOn(TelegramService, 'sendMessage').mockResolvedValue(true);

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const res = await WatchtowerService.runDiagnostics();

  expect(res.status).toBe('ok');
  expect(res.checks.sessionsLastHour.status).toBe('ok');
  expect(res.checks.gclidLast3Hours.status).toBe('ok');
  expect(tg).not.toHaveBeenCalled();
});

test('WatchtowerService.runDiagnostics: alarm triggers Telegram when any check is alarm', async () => {
  vi.spyOn(WatchtowerService, 'checkSessionVitality').mockResolvedValue(0);
  vi.spyOn(WatchtowerService, 'checkAttributionLiveness').mockResolvedValue(1);
  const tg = vi.spyOn(TelegramService, 'sendMessage').mockResolvedValue(true);

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const res = await WatchtowerService.runDiagnostics();

  expect(res.status).toBe('alarm');
  expect(res.checks.sessionsLastHour.status).toBe('alarm');
  expect(res.checks.gclidLast3Hours.status).toBe('ok');

  expect(tg).toHaveBeenCalledTimes(1);
  const [msg, level] = tg.mock.calls[0]!;
  expect(String(level)).toBe('alarm');
  expect(String(msg)).toContain('WATCHTOWER DETECTED PIPELINE STALL');
});

test('WatchtowerService.runDiagnostics: alarm also triggers webhook when configured (generic)', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.test/webhook';
  process.env.ALERT_WEBHOOK_KIND = 'generic';
  process.env.ALERT_WEBHOOK_TIMEOUT_MS = '2000';

  vi.spyOn(WatchtowerService, 'checkSessionVitality').mockResolvedValue(0);
  vi.spyOn(WatchtowerService, 'checkAttributionLiveness').mockResolvedValue(0);
  const tg = vi.spyOn(TelegramService, 'sendMessage').mockResolvedValue(true);

  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchSpy as any);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const res = await WatchtowerService.runDiagnostics();

  expect(res.status).toBe('alarm');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0]!;
  expect(String(url)).toBe('https://example.test/webhook');
  expect((init as any)?.method).toBe('POST');
  const body = String((init as any)?.body || '');
  expect(body).toContain('"service":"watchtower"');
  expect(body).toContain('"level":"alarm"');
  expect(tg).toHaveBeenCalledTimes(1);
});

test('WatchtowerService.runDiagnostics: webhook failure does not break alarm path', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://example.test/webhook';

  vi.spyOn(WatchtowerService, 'checkSessionVitality').mockResolvedValue(0);
  vi.spyOn(WatchtowerService, 'checkAttributionLiveness').mockResolvedValue(1);
  const tg = vi.spyOn(TelegramService, 'sendMessage').mockResolvedValue(true);

  const fetchSpy = vi.fn(async () => {
    throw new Error('network down');
  });
  vi.stubGlobal('fetch', fetchSpy as any);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const res = await WatchtowerService.runDiagnostics();
  expect(res.status).toBe('alarm');
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(tg).toHaveBeenCalledTimes(1);
});

test('WatchtowerService.runDiagnostics: returns alarm payload on exception (no notify)', async () => {
  vi.spyOn(WatchtowerService, 'checkSessionVitality').mockRejectedValue(new Error('db down'));
  vi.spyOn(WatchtowerService, 'checkAttributionLiveness').mockResolvedValue(1);
  const tg = vi.spyOn(TelegramService, 'sendMessage').mockResolvedValue(true);

  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  const res = await WatchtowerService.runDiagnostics();

  expect(res.status).toBe('alarm');
  expect(res.checks.sessionsLastHour.count).toBe(-1);
  expect(res.checks.gclidLast3Hours.count).toBe(-1);
  expect(tg).not.toHaveBeenCalled();
});

