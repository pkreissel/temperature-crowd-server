#!/usr/bin/env node
// Logical backup of the TemperaturCrowd database (Bunny/Turso libsql or a local file:).
//
// Produces a restorable SQL dump under ./backups. Reads are paginated by rowid so the job
// never trips libsql's RESPONSE_TOO_LARGE cap, no matter how large `readings` grows.
//
//   node backup-db.mjs                 # dump the DB in apps/api/.env -> ./backups/<ts>.sql
//   node backup-db.mjs ./my-dump.sql   # dump to an explicit path
//
// Restore (fresh DB):
//   local:  sqlite3 restored.db < backups/<file>.sql
//   turso:  turso db shell <db-name> < backups/<file>.sql

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(ROOT, 'apps', 'api');

// @libsql/client and dotenv are installed under apps/api, not the project root — resolve them
// from there so the script runs from the root regardless of where deps are hoisted.
const requireFromApi = createRequire(path.join(API_DIR, 'package.json'));
const { createClient } = requireFromApi('@libsql/client');
// Load DATABASE_URL / DATABASE_AUTH_TOKEN from apps/api/.env, without clobbering anything
// already set in the environment (e.g. when run via `node --env-file`).
requireFromApi('dotenv').config({ path: path.join(API_DIR, '.env') });

const url = process.env.DATABASE_URL || 'file:temperaturcrowd.db';
const authToken = process.env.DATABASE_AUTH_TOKEN;
const BATCH = 1000;

const db = createClient({ url, authToken });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

// SQLite literal for a single value returned by libsql (null | number | bigint | string | blob).
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return `X'${hex}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function main() {
  const outArg = process.argv[2];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(ROOT, 'backups', `temperaturcrowd-backup-${stamp}.sql`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Backups contain PII (phone_hmac, donor readings) — never let them get committed by accident.
  const gitignore = path.join(path.dirname(outPath), '.gitignore');
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, '*\n!.gitignore\n');

  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  const write = (s) => out.write(s);

  console.log(`Backing up ${url.replace(/authToken=[^&]*/i, 'authToken=***')} -> ${outPath}`);
  write(`-- TemperaturCrowd backup\n-- source: ${url.split('?')[0]}\n-- taken: ${new Date().toISOString()}\n`);
  write('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n');

  // User tables only, in dependency-friendly order (no FKs in this schema, but stable + readable).
  const tables = await q(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );

  let grandTotal = 0;
  for (const { name, sql: createSql } of tables) {
    if (!createSql) continue; // internal/shadow tables without a CREATE statement
    write(`\n-- table: ${name}\nDROP TABLE IF EXISTS ${ident(name)};\n${createSql};\n`);

    let cursor = 0;
    let count = 0;
    for (;;) {
      // Keyset-paginate on rowid: bounded response size + stable snapshot as rows are read.
      const rows = await q(
        `SELECT rowid AS __rid, * FROM ${ident(name)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        [cursor, BATCH],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => c !== '__rid');
        const colList = cols.map(ident).join(', ');
        const valList = cols.map((c) => lit(row[c])).join(', ');
        write(`INSERT INTO ${ident(name)} (${colList}) VALUES (${valList});\n`);
      }
      cursor = Number(rows[rows.length - 1].__rid);
      count += rows.length;
      if (rows.length < BATCH) break;
    }
    grandTotal += count;
    console.log(`  ${name}: ${count} rows`);
  }

  write('COMMIT;\nPRAGMA foreign_keys=ON;\n');
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  const bytes = fs.statSync(outPath).size;
  console.log(`Done: ${grandTotal} rows across ${tables.length} tables, ${(bytes / 1024).toFixed(1)} KiB -> ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
