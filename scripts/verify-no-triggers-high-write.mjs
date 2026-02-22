#!/usr/bin/env node
/**
 * Compliance Freeze: Document trigger guard query.
 * Static enforcement: tests/unit/compliance-freeze.test.ts
 * Runtime check (optional): run this SQL against DB via psql or Supabase SQL Editor.
 *
 * SQL for trigger guard (pg_trigger):
 *   SELECT t.tgname AS trigger_name, c.relname AS table_name
 *   FROM pg_trigger t
 *   JOIN pg_class c ON t.tgrelid = c.oid
 *   JOIN pg_namespace n ON c.relnamespace = n.oid
 *   WHERE n.nspname = 'public'
 *     AND c.relname IN ('sessions', 'events', 'calls')
 *     AND NOT t.tgisinternal
 *     AND t.tgname LIKE 'audit_%';
 *
 * Expected: 0 rows. If any row → compliance violation.
 */
console.log('Trigger guard: use tests/unit/compliance-freeze.test.ts for static migration scan.');
process.exit(0);
