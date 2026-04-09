/**
 * Loads the Turso N-API addon before `@tursodatabase/database` imports its `index.js`.
 *
 * Resolution order:
 * 1. `src/turso.node` beside this file (from `scripts/sync-turso-node-artifact.ts` / postinstall).
 * 2. Next to a **compiled** `sqlitey-<platform>` binary: `turso-<platform>.node` or `turso.node`.
 * 3. Next to an `sqlitey` binary (e.g. `install.sh` → `~/.local/bin/sqlitey`): same-directory
 *    `turso-darwin-arm64.node` etc. (`tursoSidecarNodeFilenameForHost`).
 * 4. Optional npm package `@tursodatabase/database-*` (e.g. `bun` running `src/index.ts`).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tursoOptionalNativePackageForHost,
  tursoSidecarNodeFilenameForHost,
} from "./turso-native-package";

const TURSO_BINDING = Symbol.for("turso.native.binding");

const r = createRequire(import.meta.url);

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
  // install.sh installs `sqlitey` + `turso-darwin-arm64.node` (not `sqlitey-darwin-arm64`).
  if (base === "sqlitey") {
    const sidecar = tursoSidecarNodeFilenameForHost();
    if (sidecar) {
      const paired = path.join(binDir, sidecar);
      if (existsSync(paired)) {
        return paired;
      }
    }
  }
  const legacy = path.join(binDir, "turso.node");
  if (existsSync(legacy)) {
    return legacy;
  }

  const optionalPkg = tursoOptionalNativePackageForHost();
  if (optionalPkg) {
    try {
      const resolved = r.resolve(optionalPkg);
      if (existsSync(resolved)) {
        return resolved;
      }
    } catch {
      /* optional dependency not installed */
    }
  }

  throw new Error(
    "Missing Turso native addon — run `bun install` in the sqlitey repo (or `bun scripts/sync-turso-node-artifact.ts`), or place `turso-<platform>.node` next to a compiled sqlitey binary.",
  );
}

(globalThis as Record<symbol, unknown>)[TURSO_BINDING] = r(resolveTursoNodePath());
