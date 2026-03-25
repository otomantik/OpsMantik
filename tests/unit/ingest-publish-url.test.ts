/**
 * QStash enqueue requires absolute https worker URLs; relative paths break ingest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('resolveAppBaseUrlForIngest: prefers NEXT_PUBLIC_APP_URL (strips slash)', async () => {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevVercel = process.env.VERCEL_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = 'https://console.example.com/';
    delete process.env.VERCEL_URL;
    const { resolveAppBaseUrlForIngest } = await import('@/lib/ingest/publish');
    assert.equal(resolveAppBaseUrlForIngest(), 'https://console.example.com');
  } finally {
    if (prevApp !== undefined) process.env.NEXT_PUBLIC_APP_URL = prevApp;
    else delete process.env.NEXT_PUBLIC_APP_URL;
    if (prevVercel !== undefined) process.env.VERCEL_URL = prevVercel;
    else delete process.env.VERCEL_URL;
  }
});

test('resolveAppBaseUrlForIngest: falls back to https + VERCEL_URL when app URL unset', async () => {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevVercel = process.env.VERCEL_URL;
  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = 'my-app.vercel.app';
    const { resolveAppBaseUrlForIngest } = await import('@/lib/ingest/publish');
    assert.equal(resolveAppBaseUrlForIngest(), 'https://my-app.vercel.app');
  } finally {
    if (prevApp !== undefined) process.env.NEXT_PUBLIC_APP_URL = prevApp;
    else delete process.env.NEXT_PUBLIC_APP_URL;
    if (prevVercel !== undefined) process.env.VERCEL_URL = prevVercel;
    else delete process.env.VERCEL_URL;
  }
});
