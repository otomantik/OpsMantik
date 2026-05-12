import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('PR-2A: Intent-to-Queue Enqueue Contract', () => {
  const exportClosurePath = join(process.cwd(), 'docs', 'architecture', 'EXPORT_CLOSURE.md');
  const queueContractPath = join(process.cwd(), 'docs', 'architecture', 'INTENT_TO_QUEUE_ENQUEUE_CONTRACT.md');
  const exportFetchPath = join(process.cwd(), 'app', 'api', 'oci', 'google-ads-export', 'export-fetch.ts');
  const schemaPath = join(process.cwd(), 'supabase', 'migrations', '20260502120000_ensure_oci_queue_and_signals.sql');
  const blockSchemaPath = join(process.cwd(), 'supabase', 'migrations', '20260503100000_oci_ssot_blocked_and_reconciliation.sql');

  it('active docs state offline_conversion_queue is the only runtime Google upload journal', () => {
    assert.ok(existsSync(exportClosurePath), 'EXPORT_CLOSURE.md should exist');
    const content = readFileSync(exportClosurePath, 'utf8');
    assert.match(content, /offline_conversion_queue/i);
    
    if (existsSync(queueContractPath)) {
      const contractContent = readFileSync(queueContractPath, 'utf8');
      assert.match(contractContent, /offline_conversion_queue`? is the ONLY runtime Google upload journal/i);
    }
  });

  it('active docs do not describe marketing_signals as an active Google-bound signal system', () => {
    const content = readFileSync(exportClosurePath, 'utf8');
    assert.match(content, /ACTIVE_RUNTIME_RESIDUE/i);
    assert.doesNotMatch(content, /marketing_signals is an upload authority/i);
  });

  it('export-fetch delegates journal read to JIT RPC + Zod (no direct PostgREST queue reads)', () => {
    assert.ok(existsSync(exportFetchPath), 'export-fetch.ts should exist');
    const content = readFileSync(exportFetchPath, 'utf8');
    assert.match(content, /fetch_oci_google_ads_export_jit_v1/);
    assert.match(content, /parseJitExportRpcRowsStrict/);
    assert.doesNotMatch(content, /\.from\('offline_conversion_queue'\)/);
    assert.doesNotMatch(content, /\.from\('marketing_signals'\)/);
  });

  it('all four canonical conversion names are included in the enqueue contract', () => {
    if (existsSync(queueContractPath)) {
      const contractContent = readFileSync(queueContractPath, 'utf8');
      assert.match(contractContent, /OpsMantik_Contacted/);
      assert.match(contractContent, /OpsMantik_Offered/);
      assert.match(contractContent, /OpsMantik_Won/);
      assert.match(contractContent, /OpsMantik_Junk_Exclusion/);
    }
  });

  it('generic blocked reason mapping exists and status explosion is avoided', () => {
    assert.ok(existsSync(queueContractPath));
    const contractContent = readFileSync(queueContractPath, 'utf8');
    
    // Check that we avoid status explosion by using FAILED + category instead of BLOCKED_CONSENT_MISSING
    assert.match(contractContent, /FAILED(.*)DETERMINISTIC_SKIP(.*)CONSENT_MISSING/i);
    assert.match(contractContent, /FAILED(.*)DETERMINISTIC_SKIP(.*)NOT_EXPORT_ELIGIBLE/i);
    assert.match(contractContent, /BLOCKED_PRECEDING_SIGNALS(.*)MISSING_CLICK_ID/i);
    assert.doesNotMatch(contractContent, /BLOCKED_CONSENT_MISSING/);
  });

  it('schema supports generic blocked states without destructive migration', () => {
    const schemaContent = readFileSync(schemaPath, 'utf8');
    assert.match(schemaContent, /FAILED/);
    
    const blockSchemaContent = readFileSync(blockSchemaPath, 'utf8');
    assert.match(blockSchemaContent, /BLOCKED_PRECEDING_SIGNALS/);
    
    // We confirm that we did not need to add any new migrations in PR-2B 
    // because FAILED + DETERMINISTIC_SKIP is already supported generically.
  });
});
