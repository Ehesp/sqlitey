/**
 * Maps `bun build --compile --target=...` to the matching `@tursodatabase/database-*` prebuild.
 * Host mapping is shared with `src/turso-native-package.ts`.
 */

export { tursoOptionalNativePackageForHost as tursoDatabasePackageForHost } from "../src/turso-native-package.ts";

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
