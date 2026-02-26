/**
 * Geo Targets Seeder — seeds google_geo_targets from Google's official CSV.
 *
 * Usage:
 *   1. Download Google Geo Targets CSV:
 *      https://developers.google.com/google-ads/api/reference/data/geotargets
 *      (Direct: https://developers.google.com/google-ads/api/data/geotargets → Download CSV)
 *      Save as: scripts/geo_targets.csv  (or pass path as first arg)
 *
 *   2. Run:
 *      node scripts/seed-geo-targets.mjs [path/to/geo_targets.csv]
 *
 * Env required (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Behaviour:
 *   - Filters for country_code === 'TR' by default (set SEED_ALL_COUNTRIES=1 to seed all)
 *   - Upserts in chunks of 500 (Supabase safe limit)
 *   - Idempotent: safe to re-run (ON CONFLICT on criteria_id)
 *   - Uses Node.js built-in readline — zero extra dependencies
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, existsSync, readdirSync } from 'fs';
import { createInterface } from 'readline';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Environment ────────────────────────────────────────────────────────────────
config({ path: resolve(ROOT, '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COUNTRY_FILTER = process.env.SEED_ALL_COUNTRIES === '1' ? null : 'TR';
const CHUNK_SIZE = 500;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌  Missing env vars. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.local');
    process.exit(1);
}

// ── CSV file resolution ────────────────────────────────────────────────────────
const csvArg = process.argv[2];

function autoDetectCsv() {
    // 1. Exact known names
    const exact = [
        resolve(process.cwd(), 'scripts', 'geo_targets.csv'),
        resolve(process.cwd(), 'geo_targets.csv'),
    ].find(existsSync);
    if (exact) return exact;

    // 2. Auto-detect any geotargets-*.csv / geo_targets*.csv in scripts/ or cwd/
    const searchDirs = [resolve(process.cwd(), 'scripts'), process.cwd()];
    for (const dir of searchDirs) {
        try {
            const match = readdirSync(dir).find(f => /^geo.?targets.*\.csv$/i.test(f));
            if (match) return resolve(dir, match);
        } catch { /* dir may not exist */ }
    }
    return null;
}

let csvPath = csvArg ? resolve(process.cwd(), csvArg) : autoDetectCsv();

if (!csvPath || !existsSync(csvPath)) {
    console.error('❌  Google Geo Targets CSV not found.');
    console.error('   Download from: https://developers.google.com/google-ads/api/data/geotargets');
    console.error('   Place file in: scripts/  (any name matching geotargets-*.csv is auto-detected)');
    console.error('   Or pass path:  node scripts/seed-geo-targets.mjs scripts/geotargets-2026-02-25.csv');
    process.exit(1);
}

console.log(`📂  Reading: ${csvPath}`);
if (COUNTRY_FILTER) {
    console.log(`🌍  Country filter: ${COUNTRY_FILTER} (set SEED_ALL_COUNTRIES=1 to seed all)`);
} else {
    console.log('🌍  Country filter: NONE — seeding all countries (~150K rows)');
}

// ── Supabase client (service_role — bypasses RLS for write) ───────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

// ── CSV parsing ────────────────────────────────────────────────────────────────
/**
 * Google Geo Targets CSV format (as of 2024):
 *   Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status
 *
 * Example:
 *   1012782,Şişli,"Şişli,İstanbul,Turkey",21167,TR,City,Active
 */
function parseCSVLine(line) {
    // Handle quoted fields (fields may contain commas)
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote inside quoted field
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    fields.push(current.trim());
    return fields;
}

async function parseGeoTargetsCSV(filePath, countryFilter) {
    return new Promise((resolve, reject) => {
        const rl = createInterface({
            input: createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        });

        const rows = [];
        let lineNum = 0;
        let headerMap = null;

        rl.on('line', (rawLine) => {
            lineNum++;
            const line = rawLine.trim();
            if (!line) return;

            const fields = parseCSVLine(line);

            if (lineNum === 1) {
                // Detect header row
                // Google CSV header: "Criteria ID,Name,Canonical Name,Parent ID,Country Code,Target Type,Status"
                if (fields[0].toLowerCase().includes('criteria')) {
                    headerMap = {
                        criteria_id: 0,
                        name: 1,
                        canonical_name: 2,
                        parent_id: 3,
                        country_code: 4,
                        target_type: 5,
                        status: 6,
                    };
                    return; // skip header
                }
                // No header — assume standard column order
                headerMap = { criteria_id: 0, name: 1, canonical_name: 2, parent_id: 3, country_code: 4, target_type: 5, status: 6 };
            }

            if (!headerMap) return;

            const criteriaId = parseInt(fields[headerMap.criteria_id], 10);
            if (isNaN(criteriaId)) return; // skip malformed rows

            const countryCode = (fields[headerMap.country_code] || '').trim().toUpperCase();

            // Apply country filter
            if (countryFilter && countryCode !== countryFilter) return;

            rows.push({
                criteria_id: criteriaId,
                name: (fields[headerMap.name] || '').trim(),
                canonical_name: (fields[headerMap.canonical_name] || '').trim(),
                parent_id: parseInt(fields[headerMap.parent_id], 10) || null,
                country_code: countryCode || null,
                target_type: (fields[headerMap.target_type] || '').trim() || null,
                status: (fields[headerMap.status] || 'Active').trim(),
            });
        });

        rl.on('close', () => resolve(rows));
        rl.on('error', reject);
    });
}

// ── Chunk helper ───────────────────────────────────────────────────────────────
function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n⏳  Parsing CSV...');
    const rows = await parseGeoTargetsCSV(csvPath, COUNTRY_FILTER);

    if (rows.length === 0) {
        console.warn(`⚠️   No rows matched country filter "${COUNTRY_FILTER ?? 'ALL'}". Check CSV format.`);
        process.exit(0);
    }

    console.log(`✅  Parsed ${rows.length} rows to upsert.`);
    console.log(`📦  Upserting in chunks of ${CHUNK_SIZE}...\n`);

    const chunks = chunk(rows, CHUNK_SIZE);
    let totalUpserted = 0;
    let totalErrors = 0;

    for (let i = 0; i < chunks.length; i++) {
        const chunkRows = chunks[i];
        const chunkLabel = `Chunk ${i + 1}/${chunks.length} (rows ${totalUpserted + 1}–${totalUpserted + chunkRows.length})`;

        process.stdout.write(`  ⬆️   ${chunkLabel} ... `);

        const { error } = await supabase
            .from('google_geo_targets')
            .upsert(chunkRows, { onConflict: 'criteria_id' });

        if (error) {
            console.error(`FAILED\n     ❌ ${error.message}`);
            totalErrors += chunkRows.length;
        } else {
            process.stdout.write(`OK\n`);
            totalUpserted += chunkRows.length;
        }

        // Small delay to avoid hammering the DB (optional, can remove for speed)
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 50));
        }
    }

    console.log('\n─────────────────────────────────────────────');
    if (totalErrors === 0) {
        console.log(`🎉  Done! Upserted ${totalUpserted} geo target rows into google_geo_targets.`);
        if (COUNTRY_FILTER) {
            console.log(`    Country: ${COUNTRY_FILTER} | Target types included: all`);
        }
        console.log('\n💡  Tip: To verify, run in Supabase SQL editor:');
        console.log(`    SELECT target_type, COUNT(*) FROM google_geo_targets${COUNTRY_FILTER ? ` WHERE country_code = '${COUNTRY_FILTER}'` : ''} GROUP BY target_type ORDER BY count DESC;`);
    } else {
        console.error(`⚠️  Completed with errors: ${totalUpserted} upserted, ${totalErrors} failed.`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('❌  Fatal error:', err.message || err);
    process.exit(1);
});
