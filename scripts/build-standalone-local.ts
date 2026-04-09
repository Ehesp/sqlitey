#!/usr/bin/env bun
/**
 * Builds one `bun build --compile` binary for the **current** OS/arch (same pipeline as `release.ts`).
 * Use to validate standalone executables without building all platforms.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";
import { ensureTursoNativePackage } from "./ensure-turso-native-package";
import { patchTursoDatabaseStaticRequire } from "./patch-turso-database-static-require";
import { tursoDatabasePackageForBunTarget } from "./turso-embed-packages";

const rootDir = path.resolve(import.meta.dir, "..");
const distDir = path.join(rootDir, "dist", "targets");

function bunTargetForHost(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin") {
    return a === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
  }
  if (p === "linux") {
    return a === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
  }
  if (p === "win32") {
    return "bun-windows-x64";
  }
  throw new Error(`Unsupported host for compile: ${p} ${a}`);
}

const bunTarget = bunTargetForHost();
const tursoPkg = tursoDatabasePackageForBunTarget(bunTarget);
if (!tursoPkg) {
  throw new Error(`No @tursodatabase/database native package mapped for ${bunTarget}`);
}

const databasePkgPath = path.join(
  rootDir,
  "node_modules",
  "@tursodatabase",
  "database",
  "package.json",
);
const databasePkg = JSON.parse(await fs.readFile(databasePkgPath, "utf8")) as {
  optionalDependencies?: Record<string, string>;
};
const rawVer = databasePkg.optionalDependencies?.[tursoPkg];
if (typeof rawVer !== "string") {
  throw new Error(`Missing optionalDependencies[${tursoPkg}] in @tursodatabase/database`);
}
const nativeVersion = rawVer.replace(/^[\^~]/, "");

await fs.mkdir(distDir, { recursive: true });
await ensureTursoNativePackage(rootDir, tursoPkg, nativeVersion);

const syncProc = Bun.spawn(
  ["bun", "run", path.join(rootDir, "scripts/sync-turso-node-artifact.ts")],
  {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  },
);
await syncProc.exited;

const platformSlug = bunTarget.replace(/^bun-/, "");
const outfile = path.join(
  distDir,
  platformSlug.startsWith("win32-") ? `sqlitey-${platformSlug}.exe` : `sqlitey-${platformSlug}`,
);

const unpatchTurso = await patchTursoDatabaseStaticRequire(rootDir);
try {
  const buildResult = await Bun.build({
    entrypoints: [path.join(rootDir, "src/index.ts")],
    root: rootDir,
    plugins: [tailwindPlugin],
    minify: true,
    sourcemap: "linked",
    env: "BUN_PUBLIC_*",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    compile: {
      target: bunTarget as Bun.Build.CompileTarget,
      outfile,
    },
  });

  if (!buildResult.success) {
    for (const log of buildResult.logs) {
      console.error(log);
    }
    throw new Error("Bun.build --compile failed");
  }

  const tursoArtifact = path.join(rootDir, "src", "turso.node");
  const tursoOut = path.join(path.dirname(outfile), `turso-${platformSlug}.node`);
  await fs.copyFile(tursoArtifact, tursoOut);
  console.log("Built standalone:", outfile);
  console.log("Copied native addon:", tursoOut);
} finally {
  await unpatchTurso();
}
