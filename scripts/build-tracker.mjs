#!/usr/bin/env node
/**
 * Build tracker bundle from lib/tracker source.
 *
 * Bundles lib/tracker into public/assets/core.js. All changes to the tracker
 * MUST be made in lib/tracker; do NOT edit public/assets/core.js manually.
 *
 * Usage: npm run tracker:build
 */

import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const entryPoint = join(rootDir, 'lib/tracker/tracker.js');
const outFile = join(rootDir, 'public/assets/core.js');

const banner = `/* eslint-disable */
// AUTO-GENERATED from lib/tracker — do not edit manually.
// Run: npm run tracker:build
`;

async function main() {
  try {
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      outfile: outFile,
      minify: false,
      banner: { js: banner },
      define: {
        'process.env.NODE_ENV': '"production"',
      },
    });
    console.log('Tracker built: public/assets/core.js');
  } catch (err) {
    console.error('Tracker build failed:', err);
    process.exit(1);
  }
}

main();
