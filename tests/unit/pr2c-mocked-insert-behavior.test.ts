import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueOciConversionRow } from '../../lib/oci/enqueue-oci-conversion-row';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

test('PR-2C: enqueueOciConversionRow calls API with FAILED + DETERMINISTIC_SKIP payload when consent missing', async (t) => {
  const fetchMock = t.mock.method(global, 'fetch', async (reqUrl: string | URL | Request, init?: RequestInit) => {
    const urlStr = reqUrl.toString();
    
    // 1. Mock the RPC call for marketing consent -> return empty scopes
    if (urlStr.includes('/rpc/get_call_session_for_oci')) {
      return new Response(JSON.stringify([{ consent_scopes: [] }]), { status: 200 });
    }
    
    // 2. Mock the DB checks (site load, calls load for intent_created_at)
    if (urlStr.includes('/rest/v1/sites')) {
      return new Response(JSON.stringify({ currency: 'TRY', oci_sync_method: 'script' }), { status: 200 });
    }
    
    if (urlStr.includes('/rest/v1/calls')) {
      return new Response(JSON.stringify({ matched_session_id: 'session-123', created_at: new Date().toISOString() }), { status: 200 });
    }

    // 3. Mock the INSERT into offline_conversion_queue
    if (urlStr.includes('/rest/v1/offline_conversion_queue') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      
      // ASSERTIONS ON THE INSERT PAYLOAD!
      assert.equal(body.status, 'FAILED', 'Insert payload status must be FAILED');
      assert.equal(body.provider_error_category, 'DETERMINISTIC_SKIP', 'Insert payload category must be DETERMINISTIC_SKIP');
      assert.equal(body.provider_error_code, 'CONSENT_MISSING', 'Insert payload code must be CONSENT_MISSING');
      
      // Return a successful insert response
      return new Response(JSON.stringify([{ id: 'mock-queue-id' }]), { status: 201 });
    }
    
    return new Response('[]', { status: 200 });
  });

  const res = await enqueueOciConversionRow({
    siteId: 'site-1',
    callId: 'call-1',
    stage: 'contacted',
    signalDate: new Date(),
    leadScore: 50,
    currency: 'TRY',
    gclid: 'mock-click',
    wbraid: null,
    gbraid: null
  });

  assert.equal(res.enqueued, false, 'Should return enqueued: false');
  assert.equal(res.reason, 'CONSENT_MISSING', 'Should return reason: CONSENT_MISSING');
  
  // Verify that the fetch to offline_conversion_queue POST actually occurred
  const insertCalls = fetchMock.mock.calls.filter(c => {
    const url = c.arguments[0].toString();
    const opts = c.arguments[1] as RequestInit | undefined;
    return url.includes('/rest/v1/offline_conversion_queue') && opts?.method === 'POST';
  });
  
  assert.equal(insertCalls.length, 1, 'Must have attempted exactly 1 insert into offline_conversion_queue');
});
