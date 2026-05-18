import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyTraffic } from '@/lib/attribution/truth-engine-core';

type Vector = {
  name: string;
  url: string;
  referrer: string;
  userAgent: string;
  previousSession?: { channel: string; hoursAgo: number };
  expected: {
    channel: string;
    is_paid: boolean;
    contradiction?: string;
    is_fraud_suspected?: boolean;
  };
};

const vectors: Vector[] = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'source-truth-vectors.json'), 'utf8')
);

const EXTENDED_REFERRERS: Array<{ host: string; channel: string }> = [
  { host: 'https://www.bing.com/search', channel: 'organic_search' },
  { host: 'https://duckduckgo.com/', channel: 'organic_search' },
  { host: 'https://www.facebook.com/', channel: 'organic_social' },
  { host: 'https://t.co/abc', channel: 'organic_social' },
  { host: 'https://claude.ai/chat', channel: 'ai_referral' },
  { host: 'https://maps.google.com/maps', channel: 'local_maps' },
  { host: 'https://g.page/my-business', channel: 'local_maps' },
  { host: 'https://partner.example/', channel: 'referral' },
];

for (const { host, channel } of EXTENDED_REFERRERS) {
  test(`golden extended: ${channel} from ${host}`, () => {
    const r = classifyTraffic('https://example.com/', host, '');
    assert.equal(r.channel, channel);
  });
}

const PAID_UTM_SOURCES = ['facebook', 'instagram', 'tiktok', 'meta', 'linkedin'] as const;
for (const src of PAID_UTM_SOURCES) {
  test(`golden matrix: paid_social utm_source=${src}`, () => {
    const r = classifyTraffic(`https://example.com/?utm_source=${src}&utm_medium=cpc`, '', '');
    assert.equal(r.channel, 'paid_social');
    assert.equal(r.is_paid, true);
  });
}

const MAPS_HOSTS = [
  'https://local.google.com/nearme',
  'https://business.google.com/dashboard',
] as const;
for (const ref of MAPS_HOSTS) {
  test(`golden matrix: local_maps ${ref}`, () => {
    const r = classifyTraffic('https://example.com/', ref, '');
    assert.equal(r.channel, 'local_maps');
    assert.equal(r.is_paid, false);
  });
}

const AI_HOSTS = ['https://chatgpt.com/', 'https://perplexity.ai/', 'https://claude.ai/new'] as const;
for (const ref of AI_HOSTS) {
  test(`golden matrix: ai ${ref}`, () => {
    const r = classifyTraffic('https://example.com/', ref, '');
    assert.equal(r.channel, 'ai_referral');
  });
}

const IN_APP_UAS = ['FBIOS', 'WhatsApp', 'TikTok 12.0', 'Instagram'] as const;
for (const marker of IN_APP_UAS) {
  test(`golden matrix: dark_social UA ${marker}`, () => {
    const r = classifyTraffic('https://example.com/', '', `Mozilla/5.0 ${marker}`);
    assert.equal(r.channel, 'dark_social');
  });
}

for (let h = 1; h <= 48; h++) {
  test(`golden matrix: deterministic replay batch ${h}`, () => {
    const url = `https://example.com/?utm_campaign=batch${h}`;
    const a = classifyTraffic(url, '', 'Mozilla/5.0');
    const b = classifyTraffic(url, '', 'Mozilla/5.0');
    assert.deepEqual(a.decision_trace, b.decision_trace);
  });
}

for (const v of vectors) {
  test(`golden: ${v.name}`, () => {
    const prev = v.previousSession
      ? {
          channel: v.previousSession.channel as import('@/lib/attribution/truth-engine-types').TrafficChannel,
          timestamp: Date.now() - v.previousSession.hoursAgo * 60 * 60 * 1000,
        }
      : undefined;
    const r = classifyTraffic(v.url, v.referrer, v.userAgent, prev);
    assert.equal(r.channel, v.expected.channel, v.name);
    assert.equal(r.is_paid, v.expected.is_paid, v.name);
    if (v.expected.contradiction) {
      assert.ok(r.contradiction_reasons.includes(v.expected.contradiction as never), v.name);
    }
    if (v.expected.is_fraud_suspected !== undefined) {
      assert.equal(r.is_fraud_suspected, v.expected.is_fraud_suspected, v.name);
    }
  });
}
