/**
 * Maps host OS/arch → `@tursodatabase/database` optionalDependency package name.
 * Used by `turso-preload` (runtime) and release/sync scripts.
 */
export function tursoOptionalNativePackageForHost(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (platform === "darwin") {
    return arch === "arm64" ? "@tursodatabase/database-darwin-arm64" : "@tursodatabase/database-darwin-x64";
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

/** Sidecar N-API filename next to the `sqlitey` binary (`install.sh` / release); must match `scripts/release.ts` `turso-${platform}.node`. */
export function tursoSidecarNodeFilenameForHost(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  if (platform === "darwin") {
    return arch === "arm64" ? "turso-darwin-arm64.node" : "turso-darwin-x64.node";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "turso-linux-arm64.node" : "turso-linux-x64.node";
  }
  if (platform === "win32") {
    return arch === "arm64" ? undefined : "turso-win32-x64.node";
  }
  return undefined;
}
