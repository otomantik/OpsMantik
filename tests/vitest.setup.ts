// Test-only environment defaults to avoid noisy "missing credentials" logs
// from modules that create clients at import time.

process.env.UPSTASH_REDIS_REST_URL ||= 'http://localhost:9999';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'test-token';

