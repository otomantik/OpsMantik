#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import {
  REASON_CODES,
  extractSqlHeaderContract,
  resolveSqlPackAbsPaths,
} from './evidence-contracts.mjs';

const ROOT = process.cwd();

function fail(code, msg) {
  console.error(`health-pack-contract:${code}: ${msg}`);
  process.exit(1);
}

const packs = resolveSqlPackAbsPaths(ROOT);
for (const pack of packs) {
  if (!existsSync(pack.absPath)) {
    fail(REASON_CODES.MISSING_SQL_PACK, `${pack.file} not found`);
  }
  const src = readFileSync(pack.absPath, 'utf8');
  const header = extractSqlHeaderContract(src);
  if (header.pack_id !== pack.pack_id) {
    fail(REASON_CODES.INVALID_SQL_CONTRACT, `${pack.file} missing @pack_id=${pack.pack_id}`);
  }
  if (header.contract_version !== pack.contract_version) {
    fail(
      REASON_CODES.INVALID_SQL_CONTRACT,
      `${pack.file} missing @contract_version=${pack.contract_version}`
    );
  }
  if (header.db_required !== String(pack.db_required)) {
    fail(REASON_CODES.INVALID_SQL_CONTRACT, `${pack.file} missing @db_required=${pack.db_required}`);
  }

  const srcLower = src.toLowerCase();
  for (const col of pack.expected_columns) {
    if (!srcLower.includes(col.toLowerCase())) {
      fail(REASON_CODES.INVALID_SQL_CONTRACT, `${pack.file} missing required column marker ${col}`);
    }
  }
}

console.log(`health-pack-contract:${REASON_CODES.PASS_WITH_WARNINGS}: PASS`);

