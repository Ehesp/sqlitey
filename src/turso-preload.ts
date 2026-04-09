/**
 * Loads the Turso N-API addon before `@tursodatabase/database` imports its `index.js`.
 *
 * - **Dev** (`bun src/index.ts`): `src/turso.node` (from `scripts/sync-turso-node-artifact.ts`).
 * - **Standalone**: `turso-<platform>.node` or legacy `turso.node` next to the executable
 *   (see `scripts/release.ts`), because compiled Bun apps cannot `require()` N-API from `$bunfs`.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TURSO_BINDING = Symbol.for("turso.native.binding");

function resolveTursoNodePath(): string {
  const besideThisFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "turso.node");
  if (existsSync(besideThisFile)) {
    return besideThisFile;
  }

  const binDir = path.dirname(process.execPath);
  const base = path.basename(process.execPath).replace(/\.exe$/i, "");
  const m = /^sqlitey-(.+)$/.exec(base);
  if (m) {
    const paired = path.join(binDir, `turso-${m[1]}.node`);
    if (existsSync(paired)) {
      return paired;
    }
  }
  const legacy = path.join(binDir, "turso.node");
  if (existsSync(legacy)) {
    return legacy;
  }

  throw new Error(
    "Missing Turso native addon — run `bun scripts/sync-turso-node-artifact.ts` (dev), or keep `turso-<platform>.node` (or `turso.node`) next to the sqlitey binary.",
  );
}

const r = createRequire(import.meta.url);
(globalThis as Record<symbol, unknown>)[TURSO_BINDING] = r(resolveTursoNodePath());
