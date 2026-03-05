#!/usr/bin/env node
/**
 * Eslamed — 22:40 röntgen + saldırı ayıklama (wrapper).
 * Ortak script'i Eslamed ile çağırır.
 *
 * Kullanım:
 *   node scripts/db/oci-eslamed-2240-rontgen-saldiri-ayikla.mjs
 *   node scripts/db/oci-eslamed-2240-rontgen-saldiri-ayikla.mjs --full
 *
 * Muratcan için:
 *   node scripts/db/oci-2240-rontgen-saldiri-ayikla.mjs Muratcan
 *   npm run db:oci-2240-rontgen-muratcan
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const script = join(__dirname, 'oci-2240-rontgen-saldiri-ayikla.mjs');
const args = ['Eslamed', ...process.argv.slice(2).filter((a) => a.startsWith('--'))];
const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', cwd: join(__dirname, '..', '..') });
child.on('exit', (code) => process.exit(code ?? 0));
