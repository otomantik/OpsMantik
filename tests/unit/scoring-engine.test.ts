import { test } from 'node:test';
import assert from 'node:assert';
import { calculateBrainScore } from '../../lib/ingest/scoring-engine';

test('Brain Score: Base case', () => {
    const result = calculateBrainScore({ intent_action: 'click' }, null);
    // 10 (base) + 15 (click) = 25
    assert.strictEqual(result.score, 25);
    assert.strictEqual(result.breakdown.base, '+10 (Base)');
    assert.strictEqual(result.breakdown.action, '+15 (Click/Copy)');
});

test('Brain Score: Apple WhatsApp High Score', () => {
    const result = calculateBrainScore(
        {
            ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            intent_action: 'whatsapp'
        },
        { keyword: 'cheap luxury watches', geo_target_id: 1012782 }
    );
    // 10 (base) + 20 (Apple) + 40 (WhatsApp) + 15 (Keyword) + 15 (Geo) = 100
    assert.strictEqual(result.score, 100);
    assert.strictEqual(result.breakdown.device, '+20 (Apple)');
    assert.strictEqual(result.breakdown.action, '+40 (WhatsApp)');
    assert.strictEqual(result.breakdown.ads_keyword, '+15 (Has Keyword)');
    assert.strictEqual(result.breakdown.ads_geo, '+15 (Rich Geo Data)');
});

test('Brain Score: Android Phone Call', () => {
    const result = calculateBrainScore(
        {
            ua: 'Mozilla/5.0 (Linux; Android 10)',
            intent_action: 'phone'
        },
        null
    );
    // 10 (base) + 10 (Android) + 30 (Phone) = 50
    assert.strictEqual(result.score, 50);
    assert.strictEqual(result.breakdown.device, '+10 (Android/Windows)');
    assert.strictEqual(result.breakdown.action, '+30 (Phone)');
});

test('Brain Score: Caps at 100', () => {
    const result = calculateBrainScore(
        {
            ua: 'iPhone',
            intent_action: 'whatsapp'
        },
        { keyword: 'k', geo_target_id: 1 }
    );
    // 10 + 20 + 40 + 15 + 15 = 100
    // Even if we added more, it should cap.
    assert.strictEqual(result.score, 100);
});
