import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * `@tursodatabase/database/index.js` ends with `nativeBinding = requireNative()` which loads an
 * optional `@tursodatabase/database-*` package. That path does not embed in `bun build --compile`.
 *
 * We load the same `.node` via `src/turso-preload.ts` + relative `turso-native/turso.node` (embedded),
 * stash it on `globalThis[Symbol.for("turso.native.binding")]`, and temporarily replace this line so
 * the driver reuses that binding.
 */
const MARKER = "nativeBinding = requireNative()";
const REPLACEMENT = "nativeBinding = globalThis[Symbol.for(\"turso.native.binding\")]";

export async function patchTursoDatabaseStaticRequire(rootDir: string): Promise<() => Promise<void>> {
  const filePath = path.join(rootDir, "node_modules", "@tursodatabase", "database", "index.js");
  const original = await fs.readFile(filePath, "utf8");
  if (!original.includes(MARKER)) {
    throw new Error(
      `patch-turso-database: expected \`${MARKER}\` in @tursodatabase/database/index.js — package version may have changed`,
    );
  }
  await fs.writeFile(filePath, original.replace(MARKER, REPLACEMENT), "utf8");
  return async () => {
    await fs.writeFile(filePath, original, "utf8");
  };
}
