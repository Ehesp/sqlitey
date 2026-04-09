#!/usr/bin/env bun
/**
 * Copies the current platform's `turso.*.node` from `node_modules/@tursodatabase/database-*`
 * to `src/turso.node` (next to `index.ts`) so `bun build --compile` can embed it via
 * `require("./turso.node")` (see https://bun.com/docs/bundler/executables#embed-n-api-addons).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { tursoDatabasePackageForHost } from "./turso-embed-packages";

const rootDir = path.resolve(import.meta.dir, "..");
const outFile = path.join(rootDir, "src", "turso.node");

const pkg = tursoDatabasePackageForHost();
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
