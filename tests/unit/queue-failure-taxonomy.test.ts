import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateQueueFailureTaxonomy, computeTaxonomyRates } from '../../lib/oci/queue-failure-taxonomy';

describe('queue-failure-taxonomy', () => {
  it('SUPPRESSED_BY_HIGHER_GEAR rows count as FAILED + DETERMINISTIC_SKIP + suppressed code', () => {
    const rows = [
      { status: 'FAILED', provider_error_category: 'DETERMINISTIC_SKIP', provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR' },
    ];
    const t = aggregateQueueFailureTaxonomy(rows);
    assert.equal(t.total_failed_count, 1);
    assert.equal(t.deterministic_skip_count, 1);
    assert.equal(t.suppressed_higher_gear_count, 1);
    assert.equal(t.actionable_failed_count, 0);
    assert.equal(t.provider_failed_count, 0);
  });

  it('deterministic skips are visible but excluded from actionable_failed_rate numerator', () => {
    const taxonomy = aggregateQueueFailureTaxonomy([
      { status: 'FAILED', provider_error_category: 'DETERMINISTIC_SKIP', provider_error_code: 'SUPPRESSED_BY_HIGHER_GEAR' },
      { status: 'FAILED', provider_error_category: 'DETERMINISTIC_SKIP', provider_error_code: 'OTHER' },
    ]);
    const rates = computeTaxonomyRates({
      totalQueue: 10,
      taxonomy,
      deadLetterQuarantineCount: 0,
    });
    assert.equal(rates.actionable_failed_rate, 0);
    assert.equal(rates.deterministic_skip_rate, 0.2);
    assert.equal(rates.provider_failed_rate, 0);
  });

  it('TRANSIENT FAILED counts as provider failure, not deterministic skip', () => {
    const taxonomy = aggregateQueueFailureTaxonomy([
      { status: 'FAILED', provider_error_category: 'TRANSIENT', provider_error_code: 'GATEWAY' },
    ]);
    assert.equal(taxonomy.provider_failed_count, 1);
    assert.equal(taxonomy.deterministic_skip_count, 0);
    const rates = computeTaxonomyRates({
      totalQueue: 10,
      taxonomy,
      deadLetterQuarantineCount: 0,
    });
    assert.equal(rates.provider_failed_rate, 0.1);
  });
});
