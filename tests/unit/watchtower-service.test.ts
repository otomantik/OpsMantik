import { afterEach, test, expect, vi } from 'vitest';

import { WatchtowerService } from '@/lib/services/watchtower';
import { TelegramService } from '@/lib/services/telegram-service';

afterEach(() => {
  vi.restoreAllMocks();
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

