#!/usr/bin/env bun
/**
 * Create a local SQLite file and seed it for development (same data as seed-50k).
 *
 * Usage:
 *   bun scripts/dev-db.ts
 *   bun scripts/dev-db.ts ./path/to.db
 *   bun scripts/dev-db.ts --fresh
 *   bun scripts/dev-db.ts --fresh ./path/to.db
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { seedPerfDummy } from "./seed-50k";

const argv = process.argv.slice(2);
const fresh = argv.some((a) => a === "--fresh" || a === "-f");
const positional = argv.filter((a) => !a.startsWith("-"));
const dbPath = path.resolve(positional[0] ?? "./app.db");

if (fresh) {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(p, { force: true });
  }
  console.log(`Removed existing DB files for ${dbPath}\n`);
}

seedPerfDummy(dbPath);

console.log(`\nDev database ready: ${dbPath}`);
console.log(`  bun --hot src/index.ts --no-open ${dbPath}`);
