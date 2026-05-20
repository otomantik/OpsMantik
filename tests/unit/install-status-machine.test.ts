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

test('install status: installed_no_events when origin registered, verification unknown', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: null,
      lastEventAt: null,
      hasIntentCalls: false,
    }),
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

test('install status: events_received when only non-heartbeat events', () => {
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

test('install status: no_heartbeat when only heartbeat action without heartbeat timestamp', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      lastEventAt: new Date().toISOString(),
      lastEventAction: 'heartbeat',
      lastHeartbeatAt: null,
    }),
    'no_heartbeat'
  );
});

test('install status: origin_mismatch', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: false,
    }),
    'origin_mismatch'
  );
});

test('install status: consent_missing', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      consentAnalyticsPresent: false,
    }),
    'consent_missing'
  );
});

test('install status: script_outdated', () => {
  assert.equal(
    deriveInstallReadiness({
      ...base,
      originCount: 1,
      originVerified: true,
      scriptVersion: '7',
      liveScriptVersion: '6',
    }),
    'script_outdated'
  );
});

test('install status: deriveInstallReadiness does not emit unknown for registered origin without events', () => {
  const state = deriveInstallReadiness({
    ...base,
    originCount: 1,
    originVerified: null,
    lastEventAt: null,
  });
  assert.notEqual(state, 'unknown');
  assert.equal(state, 'installed_no_events');
});
