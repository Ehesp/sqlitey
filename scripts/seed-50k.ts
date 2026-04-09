/**
 * Seeds a SQLite file with perf_dummy (50k rows) for pagination / virtual scroll testing.
 * Usage: bun scripts/seed-50k.ts [path-to.db]
 * Default DB path: ./app.db
 */
import { Database } from "bun:sqlite";

const ROW_COUNT = 50_000;

const categories = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
const statuses = ["active", "pending", "archived", "draft"] as const;

/** Creates or overwrites `perf_dummy` and fills it with sample rows. */
export function seedPerfDummy(dbPath: string): void {
  const db = new Database(dbPath);

  db.exec("DROP TABLE IF EXISTS perf_dummy");
  db.exec(`
    CREATE TABLE perf_dummy (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      status TEXT,
      score INTEGER,
      amount REAL,
      created_at TEXT
    )
  `);

  const insert = db.prepare(`
    INSERT INTO perf_dummy (id, name, category, status, score, amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedAll = db.transaction(() => {
    for (let id = 1; id <= ROW_COUNT; id++) {
      insert.run(
        id,
        `row_${id}`,
        categories[id % categories.length],
        statuses[id % statuses.length],
        (id * 7) % 10_000,
        Math.round(((id * 13.37) % 5000) * 100) / 100,
        new Date(Date.UTC(2024, 0, 1) + id * 86_400_000).toISOString(),
      );
    }
  });

  const t0 = performance.now();
  seedAll();
  const ms = (performance.now() - t0).toFixed(0);

  const [{ n }] = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM perf_dummy").all();
  console.log(`Wrote ${n} rows to ${dbPath} in ${ms}ms`);

  db.close();
}

if (import.meta.main) {
  seedPerfDummy(process.argv[2] ?? "./app.db");
}
