#!/usr/bin/env node
/**
 * OCI credentials - scripts/get-oci-credentials.mjs wrapper
 *
 * Kullanim:
 *   node scripts/db/oci-credentials.mjs Eslamed
 *   node scripts/db/oci-credentials.mjs Eslamed --write
 */
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainScript = join(__dirname, '..', 'get-oci-credentials.mjs');

const child = spawn('node', [mainScript, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: join(__dirname, '..', '..'),
});

child.on('exit', (code) => process.exit(code ?? 0));
