import { promises as fs } from "node:fs";
import path from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";
import { ensureTursoNativePackage } from "./ensure-turso-native-package";
import { patchTursoDatabaseStaticRequire } from "./patch-turso-database-static-require";
import { tursoDatabasePackageForBunTarget } from "./turso-embed-packages";

const rootDir = path.resolve(import.meta.dir, "..");
const distDir = path.join(rootDir, "dist", "targets");
await fs.mkdir(distDir, { recursive: true });

/** Windows arm64 has no `@tursodatabase/database-win32-arm64-msvc` in optional deps yet — omit. */
const TARGETS: { bunTarget: string; platform: string }[] = [
  { bunTarget: "bun-darwin-arm64", platform: "darwin-arm64" },
  { bunTarget: "bun-darwin-x64", platform: "darwin-x64" },
  { bunTarget: "bun-linux-x64", platform: "linux-x64" },
  { bunTarget: "bun-linux-arm64", platform: "linux-arm64" },
  { bunTarget: "bun-windows-x64", platform: "win32-x64" },
];

async function readTursoNativeVersion(): Promise<string> {
  const pkgPath = path.join(rootDir, "node_modules", "@tursodatabase", "database", "package.json");
  const raw = await fs.readFile(pkgPath, "utf8");
  const j = JSON.parse(raw) as { optionalDependencies?: Record<string, string> };
  const v = j.optionalDependencies?.["@tursodatabase/database-darwin-arm64"];
  if (typeof v !== "string") {
    throw new Error(
      "Could not read @tursodatabase/database-darwin-arm64 version from @tursodatabase/database optionalDependencies",
    );
  }
  return v.replace(/^[\^~]/, "");
}

let nativeVersion: string;
try {
  nativeVersion = await readTursoNativeVersion();
} catch {
  console.error(
    "Run `bun install` before scripts/release.ts so node_modules/@tursodatabase/database exists.",
  );
  process.exit(1);
}

let releaseFailed: unknown;

try {
  for (const { bunTarget, platform } of TARGETS) {
    const tursoPkg = tursoDatabasePackageForBunTarget(bunTarget);
    if (!tursoPkg) {
      throw new Error(`No Turso Database native package mapped for ${bunTarget}`);
    }

    await ensureTursoNativePackage(rootDir, tursoPkg, nativeVersion);

    const outfile = path.join(
      distDir,
      platform.startsWith("win32-") ? `sqlitey-${platform}.exe` : `sqlitey-${platform}`,
    );

    const syncProc = Bun.spawn(
      ["bun", "run", path.join(rootDir, "scripts/sync-turso-node-artifact.ts")],
      {
        cwd: rootDir,
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    await syncProc.exited;

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
        throw new Error(`Bun.build failed for ${platform} (target: ${bunTarget})`);
      }

      const tursoArtifact = path.join(rootDir, "src", "turso.node");
      const tursoOut = path.join(path.dirname(outfile), `turso-${platform}.node`);
      await fs.copyFile(tursoArtifact, tursoOut);

      console.log("Built", platform, "+", path.basename(tursoOut));
    } finally {
      await unpatchTurso();
    }
  }
} catch (error) {
  releaseFailed = error;
  console.error("Release build failed:", error);
} finally {
  const reinstall = Bun.spawn(["bun", "install"], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  await reinstall.exited;
}

if (releaseFailed) {
  process.exit(1);
}

console.log("Built all platforms");
