/**
 * Maps `bun build --compile --target=...` to the matching `@tursodatabase/database-*` prebuild.
 * Preload via `src/turso-native.generated.ts` so Bun embeds the N-API addon in compiled binaries.
 * @see https://bun.com/docs/bundler/executables#embed-n-api-addons
 */

/** Bun --target value → npm package name for Turso Database native addon */
export const BUN_TARGET_TO_TURSO_DATABASE: Record<string, string> = {
  "bun-darwin-arm64": "@tursodatabase/database-darwin-arm64",
  "bun-darwin-x64": "@tursodatabase/database-darwin-x64",
  "bun-linux-x64": "@tursodatabase/database-linux-x64-gnu",
  "bun-linux-arm64": "@tursodatabase/database-linux-arm64-gnu",
  "bun-windows-x64": "@tursodatabase/database-win32-x64-msvc",
};

export function tursoDatabasePackageForBunTarget(bunTarget: string): string | undefined {
  return BUN_TARGET_TO_TURSO_DATABASE[bunTarget];
}

/** For local dev / postinstall: pick the native package for the current process. */
export function tursoDatabasePackageForHost(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (platform === "darwin") {
    return arch === "arm64"
      ? "@tursodatabase/database-darwin-arm64"
      : "@tursodatabase/database-darwin-x64";
  }
  if (platform === "linux") {
    return arch === "arm64"
      ? "@tursodatabase/database-linux-arm64-gnu"
      : "@tursodatabase/database-linux-x64-gnu";
  }
  if (platform === "win32") {
    return arch === "arm64" ? undefined : "@tursodatabase/database-win32-x64-msvc";
  }
  return undefined;
}
