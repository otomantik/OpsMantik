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

/** `var NAME = '';` — used for SITE_ID; API_KEY stays empty in generated output. */
function replaceEmptyStringVar(source, name, value) {
  const re = new RegExp(`var ${name} = '';`);
  if (!re.test(source)) {
    throw new Error(`Missing empty-string inline variable ${name} in Universal template`);
  }
  return source.replace(re, `var ${name} = ${jsString(value)};`);
}

/** `var NAME = '...';` (any single-quoted body). */
function replaceQuotedStringVar(source, name, value) {
  const re = new RegExp(`var ${name} = '[^']*';`);
  if (!re.test(source)) {
    throw new Error(`Missing quoted inline variable ${name} in Universal template`);
  }
  return source.replace(re, `var ${name} = ${jsString(value)};`);
}

const site = parseSiteArg(process.argv.slice(2));
if (!site) {
  throw new Error('Usage: npm run build:google-ads-script -- --site=<slug>');
}

const configPath = path.join(__dirname, 'sites', `${site}.json`);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const templatePath = path.join(__dirname, 'GoogleAdsScriptUniversal.js');
let source = await readFile(templatePath, 'utf8');

source = replaceEmptyStringVar(source, 'SITE_ID', config.siteId);
source = replaceEmptyStringVar(source, 'API_KEY', '');
source = replaceQuotedStringVar(source, 'BASE_URL', config.baseUrl ?? 'https://console.opsmantik.com');
source = replaceQuotedStringVar(source, 'RUN_MODE', config.runMode ?? 'sync');
source = replaceQuotedStringVar(source, 'EXPORT_LIMIT', String(config.exportLimit ?? 50));

if (config.maxPages != null) {
  source = replaceQuotedStringVar(source, 'MAX_PAGES', String(config.maxPages));
}
if (config.maxRuntimeMs != null) {
  source = replaceQuotedStringVar(source, 'MAX_RUNTIME_MS', String(config.maxRuntimeMs));
}
if (config.includeHashedPhone != null) {
  source = replaceQuotedStringVar(source, 'INCLUDE_HASHED_PHONE', String(config.includeHashedPhone));
}
if (config.hashedPhoneColumn != null) {
  source = replaceQuotedStringVar(source, 'HASHED_PHONE_COLUMN', String(config.hashedPhoneColumn));
}

const banner = [
  '/**',
  ` * Generated Google Ads OCI script for ${site}.`,
  ' * Source template: scripts/google-ads-oci/GoogleAdsScriptUniversal.js (canonical fleet script).',
  ` * Generated at: ${new Date().toISOString()}`,
  ' * API_KEY remains empty — set OPSMANTIK_API_KEY in Google Ads Script Properties.',
  ` * Site config source: scripts/google-ads-oci/sites/${site}.json`,
  ` * Metadata (not injected into Universal motor): operatorId=${JSON.stringify(config.operatorId ?? '')}, changeTicket=${JSON.stringify(config.changeTicket ?? '')}`,
  ' */',
  '',
].join('\n');

const outDir = path.join(__dirname, 'dist');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `google-ads-script-${site}.js`);
await writeFile(outPath, banner + source, 'utf8');
console.log(outPath);
