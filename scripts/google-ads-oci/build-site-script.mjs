import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseSiteArg(argv) {
  const direct = argv.find((arg) => arg.startsWith('--site='));
  if (direct) return direct.slice('--site='.length);
  const idx = argv.indexOf('--site');
  if (idx >= 0) return argv[idx + 1];
  return null;
}

function jsString(value) {
  return JSON.stringify(String(value ?? ''));
}

function replaceInlineVar(source, name, value) {
  const re = new RegExp(`var ${name} = '[^']*';`);
  const next = `var ${name} = ${jsString(value)};`;
  if (!re.test(source)) {
    throw new Error(`Missing inline variable ${name} in production template`);
  }
  return source.replace(re, next);
}

const site = parseSiteArg(process.argv.slice(2));
if (!site) {
  throw new Error('Usage: npm run build:google-ads-script -- --site=<slug>');
}

const configPath = path.join(__dirname, 'sites', `${site}.json`);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const templatePath = path.join(__dirname, 'GoogleAdsScriptProduction.js');
let source = await readFile(templatePath, 'utf8');

source = replaceInlineVar(source, 'OPSMANTIK_INLINE_SITE_ID', config.siteId);
source = replaceInlineVar(source, 'OPSMANTIK_INLINE_BASE_URL', config.baseUrl ?? 'https://console.opsmantik.com');
source = replaceInlineVar(source, 'OPSMANTIK_INLINE_EXPORT_LIMIT', config.exportLimit ?? 50);
source = replaceInlineVar(source, 'OPSMANTIK_INLINE_RUN_MODE', config.runMode ?? 'sync');
source = replaceInlineVar(source, 'OPSMANTIK_INLINE_OPERATOR_ID', config.operatorId ?? 'google-ads-script');
source = replaceInlineVar(source, 'OPSMANTIK_INLINE_CHANGE_TICKET', config.changeTicket ?? `site-${site}`);

const banner = [
  '/**',
  ` * Generated Google Ads OCI script for ${site}.`,
  ' * Source template: scripts/google-ads-oci/GoogleAdsScriptProduction.js',
  ` * Generated at: ${new Date().toISOString()}`,
  ' * API key remains empty; set OPSMANTIK_API_KEY in Google Ads Script Properties.',
  ' */',
  '',
].join('\n');

const outDir = path.join(__dirname, 'dist');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `google-ads-script-${site}.js`);
await writeFile(outPath, banner + source, 'utf8');
console.log(outPath);
