#!/usr/bin/env bun
/**
 * Copies `turso.*.node` from `node_modules/@tursodatabase/database-*` to `src/turso.node`
 * (next to `index.ts`) so `bun build --compile` can embed it via `require("./turso.node")`.
 *
 * - **Default:** uses the **host** OS/arch (postinstall / local dev).
 * - **`SQLITEY_TURSO_NATIVE_PACKAGE`:** full npm package name to copy (required when cross-compiling
 *   on CI: Linux runners must sync `database-darwin-arm64`, not `database-linux-*`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { tursoDatabasePackageForHost } from "./turso-embed-packages";

const rootDir = path.resolve(import.meta.dir, "..");
const outFile = path.join(rootDir, "src", "turso.node");

const explicit = process.env.SQLITEY_TURSO_NATIVE_PACKAGE?.trim();
const pkg = explicit || tursoDatabasePackageForHost();
if (!pkg) {
  console.warn("sync-turso-node-artifact: unsupported platform; skipping.");
  process.exit(0);
}

const pkgJsonPath = path.join(rootDir, "node_modules", ...pkg.split("/"), "package.json");
const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as { main?: string };
const main = pkgJson.main;
if (typeof main !== "string" || !main.endsWith(".node")) {
  throw new Error(`Unexpected main in ${pkg}: ${main}`);
}

const srcNode = path.join(path.dirname(pkgJsonPath), main);
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.copyFile(srcNode, outFile);
console.log("sync-turso-node-artifact:", srcNode, "→", outFile);
