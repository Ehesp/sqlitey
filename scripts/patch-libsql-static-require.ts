import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * libsql uses `return require(\`@libsql/${target}\`)` so bundlers cannot trace which native
 * addon to embed. Bun's compiled binary then fails to resolve `@libsql/...` from $bunfs.
 *
 * Temporarily replace with `return require("@libsql/<exact>")` before `bun build --compile`,
 * then restore from snapshots. See node_modules/libsql/index.js and promise.js.
 */
const FILES = ["index.js", "promise.js"] as const;

export async function patchLibsqlToStaticRequire(
  rootDir: string,
  npmPackage: string
): Promise<() => Promise<void>> {
  const libsqlDir = path.join(rootDir, "node_modules", "libsql");
  const snapshots = new Map<string, string>();

  for (const name of FILES) {
    const filePath = path.join(libsqlDir, name);
    const original = await fs.readFile(filePath, "utf8");
    snapshots.set(filePath, original);
    const replacement = `return require(${JSON.stringify(npmPackage)});`;
    const next = original.replace(/return require\(`@libsql\/\$\{target\}`\);/g, replacement);
    if (next === original) {
      throw new Error(
        `patch-libsql: expected dynamic require pattern not found in libsql/${name} — libsql version may have changed`
      );
    }
    await fs.writeFile(filePath, next, "utf8");
  }

  return async () => {
    for (const [filePath, content] of snapshots) {
      await fs.writeFile(filePath, content, "utf8");
    }
  };
}
