import { promises as fs } from "node:fs";
import path from "node:path";

function tarballUrl(packageName: string, version: string): string {
  const encoded = encodeURIComponent(packageName);
  const shortName = packageName.includes("/") ? packageName.split("/")[1]! : packageName;
  return `https://registry.npmjs.org/${encoded}/-/${shortName}-${version}.tgz`;
}

/**
 * Install a specific `@tursodatabase/database-*` platform package into `node_modules` from npm,
 * so `require("@tursodatabase/database-…")` resolves during `bun build --compile --target=…`
 * when cross-compiling.
 */
export async function ensureTursoNativePackage(
  rootDir: string,
  packageName: string,
  version: string,
): Promise<void> {
  const tmp = path.join(rootDir, ".tmp-turso-pack");
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });

  const url = tarballUrl(packageName, version);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tgzPath = path.join(tmp, "pkg.tgz");
  await fs.writeFile(tgzPath, buf);

  const tarProc = Bun.spawn(["tar", "-xzf", tgzPath, "-C", tmp], { cwd: rootDir });
  if ((await tarProc.exited) !== 0) {
    throw new Error(`tar -xzf failed for downloaded ${packageName}`);
  }

  const parts = packageName.split("/");
  const dest =
    packageName.startsWith("@") && parts.length >= 2
      ? path.join(rootDir, "node_modules", parts[0]!, parts[1]!)
      : path.join(rootDir, "node_modules", packageName);

  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(path.join(tmp, "package"), dest);

  await fs.rm(tmp, { recursive: true, force: true });
}
