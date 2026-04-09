/**
 * Maps `bun build --compile --target=...` to the matching `@libsql/*` prebuilt package.
 * These must be imported statically so Bun embeds the `.node` addon (dynamic `require` in libsql is not traced).
 * @see https://bun.com/docs/bundler/executables#embed-n-api-addons
 */

/** Bun --target value → npm package name for libsql's native addon */
export const BUN_TARGET_TO_LIBSQL: Record<string, string> = {
  "bun-darwin-arm64": "@libsql/darwin-arm64",
  "bun-darwin-x64": "@libsql/darwin-x64",
  "bun-linux-x64": "@libsql/linux-x64-gnu",
  "bun-linux-arm64": "@libsql/linux-arm64-gnu",
  "bun-windows-x64": "@libsql/win32-x64-msvc",
};

export function libsqlPackageForBunTarget(bunTarget: string): string | undefined {
  return BUN_TARGET_TO_LIBSQL[bunTarget];
}

/** For local dev / postinstall: pick the native package for the current process. */
export function libsqlPackageForHost(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | undefined {
  if (platform === "darwin") {
    return arch === "arm64" ? "@libsql/darwin-arm64" : "@libsql/darwin-x64";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "@libsql/linux-arm64-gnu" : "@libsql/linux-x64-gnu";
  }
  if (platform === "win32") {
    return arch === "arm64" ? undefined : "@libsql/win32-x64-msvc";
  }
  return undefined;
}
