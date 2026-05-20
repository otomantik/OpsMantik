import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveInstallReadiness, type InstallHealthInput } from '@/lib/panel/install-status';

const base: InstallHealthInput = {
  originCount: 0,
  originVerified: null,
  lastEventAt: null,
  lastEventAction: null,
  lastHeartbeatAt: null,
  trafficReceiving: null,
  hasIntentCalls: false,
  scriptVersion: '7',
  liveScriptVersion: null,
  consentAnalyticsPresent: null,
};

test('install status: not_installed', () => {
  assert.equal(deriveInstallReadiness(base), 'not_installed');
});

test('install status: installed_no_events', () => {
  assert.equal(
    deriveInstallReadiness({ ...base, originCount: 1, originVerified: true }),
    'installed_no_events'
  );
});

test('install status: events_received', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      lastEventAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      lastEventAction: 'heartbeat',
    }),
    'events_received'
  );
});

test('install status: intent_events_received', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      lastEventAt: new Date().toISOString(),
      hasIntentCalls: true,
    }),
    'intent_events_received'
  );
});

test('install status: conversion_ready', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      lastEventAt: new Date().toISOString(),
      trafficReceiving: true,
      hasIntentCalls: true,
    }),
    'conversion_ready'
  );
});

test('install status: no_heartbeat when only non-heartbeat events', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      lastEventAt: new Date().toISOString(),
      lastEventAction: 'page_view',
      lastHeartbeatAt: null,
    }),
    'events_received'
  );
});

test('install status: unknown when no signals', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: null,
      lastEventAt: null,
      hasIntentCalls: false,
    }),
    'unknown'
  );
});
