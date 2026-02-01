#!/usr/bin/env node
/**
 * Sentry test: calls GET /api/sentry-example-api (throws -> 500).
 * Sentry should capture the error; check Sentry Issues after run.
 * Usage: node scripts/test-sentry.mjs [BASE_URL]
 * Default BASE_URL: http://localhost:3000
 */

const base = process.argv[2] || 'http://localhost:3000';
const url = `${base.replace(/\/$/, '')}/api/sentry-example-api`;

async function main() {
  console.log('--- Sentry test (example API) ---');
  console.log('GET', url);

  try {
    const res = await fetch(url);
    if (res.status === 500) {
      console.log('OK: Route returned 500 (error thrown). Check Sentry Issues for the event.');
      process.exit(0);
    }
    console.log('Unexpected status:', res.status);
    const text = await res.text();
    if (text) console.log('Body:', text.slice(0, 200));
    process.exit(1);
  } catch (err) {
    console.error('Request failed:', err.message);
    if (base.includes('localhost') && err.cause?.code === 'ECONNREFUSED') {
      console.log('Tip: Start dev server with "npm run dev" then run this script again.');
    }
    process.exit(1);
  }
}

main();
