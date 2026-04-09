import "./libsql-native.generated";
import { createClient, type Row } from "@libsql/client";
import { serve } from "bun";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import index from "./index.html";

const APP_VERSION = "0.1.0";
const APP_NAME = "sqlitey";
const DEFAULT_PORT = 4983;
const MAX_PAGE_SIZE = 500;

type CliOptions = {
  host: string;
  port: number;
  open: boolean;
  dbPath: string;
};

type TableColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type ForeignKeyInfo = {
  from: string[];
  toTable: string;
  toColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
};

type SchemaObject = {
  name: string;
  type: "table" | "view";
  sql: string | null;
  rowCount: number | null;
  columns: TableColumn[];
  foreignKeys: ForeignKeyInfo[];
};

type SortInput = {
  id: string;
  desc?: boolean;
};

type FilterInput = {
  id: string;
  value: string;
};

type RouteRequest = Request & {
  params: Record<string, string | undefined>;
};

const cli = parseCliArgs(process.argv.slice(2));
const dbPath = path.resolve(process.cwd(), cli.dbPath);

if (!existsSync(dbPath)) {
  console.error(`Database file does not exist: ${dbPath}`);
  console.error(`Create it first, e.g.: sqlite3 "${dbPath}" "VACUUM;"`);
  process.exit(1);
}

const selectedPort = await findAvailablePort(cli.host, cli.port);
const sessionToken = createSessionToken();
const db = createClient({
  url: `file:${dbPath}`,
});

const withAuth = (handler: (req: RouteRequest) => Promise<Response>) => {
  return async (req: RouteRequest) => {
    if (!isAuthorized(req, sessionToken)) {
      return json({ error: "Unauthorized" }, 401);
    }
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("SQLITE_") ? 400 : 500;
      return json({ error: message }, status);
    }
  };
};

const server = serve({
  hostname: cli.host,
  port: selectedPort,
  routes: {
    "/": index,
    "/api/meta": {
      GET: withAuth(async () => {
        const customTypes = await listCustomTypes(db);
        return json({
          name: APP_NAME,
          version: APP_VERSION,
          dialect: "libsql (SQLite-compatible)",
          dbPath,
          host: cli.host,
          port: selectedPort,
          customTypes,
          docs: "https://www.sqlite.org/docs.html",
        });
      }),
    },
    "/api/schema": {
      GET: withAuth(async () => {
        const objects = await readSchema(db);
        return json({ objects });
      }),
    },
    "/api/tables/:name/columns": {
      GET: withAuth(async req => {
        const tableNameParam = req.params.name;
        if (!tableNameParam) {
          return json({ error: "Table name is required" }, 400);
        }
        const tableName = decodeURIComponent(tableNameParam);
        const columns = await readTableColumns(db, tableName);
        return json({ table: tableName, columns });
      }),
    },
    "/api/tables/:name/rows": {
      GET: withAuth(async req => {
        const tableNameParam = req.params.name;
        if (!tableNameParam) {
          return json({ error: "Table name is required" }, 400);
        }
        const tableName = decodeURIComponent(tableNameParam);
        const url = new URL(req.url);
        const limit = clampInt(url.searchParams.get("limit"), 100, 1, MAX_PAGE_SIZE);
        const offset = clampInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
        const sort = parseJsonSafe<SortInput[]>(url.searchParams.get("sort"))?.[0] ?? null;
        const filters = parseJsonSafe<FilterInput[]>(url.searchParams.get("filters")) ?? [];

        const { whereSql, args } = buildWhereClause(filters);
        const orderBySql = sort?.id ? ` ORDER BY ${quoteIdentifier(sort.id)} ${sort.desc ? "DESC" : "ASC"}` : "";

        const rowsResult = await db.execute({
          sql: `SELECT * FROM ${quoteIdentifier(tableName)}${whereSql}${orderBySql} LIMIT ? OFFSET ?`,
          args: [...args, limit, offset],
        });
        const countResult = await db.execute({
          sql: `SELECT COUNT(*) AS total FROM ${quoteIdentifier(tableName)}${whereSql}`,
          args,
        });

        const totalRaw = countResult.rows[0]?.total;
        const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw ?? 0);

        return json({
          table: tableName,
          columns: rowsResult.columns,
          rows: rowsResult.rows.map(normalizeRow),
          page: {
            limit,
            offset,
            total,
          },
        });
      }),
    },
    "/api/tables/:name/ddl": {
      GET: withAuth(async req => {
        const tableNameParam = req.params.name;
        if (!tableNameParam) {
          return json({ error: "Table name is required" }, 400);
        }
        const tableName = decodeURIComponent(tableNameParam);
        const schemaResult = await db.execute({
          sql: "SELECT sql, type FROM sqlite_schema WHERE name = ? AND type IN ('table', 'view')",
          args: [tableName],
        });
        const row = schemaResult.rows[0] as Row | undefined;
        const ddl = typeof row?.sql === "string" ? row.sql : null;
        const objectType = row?.type === "view" ? "view" : "table";
        return json({
          table: tableName,
          type: objectType,
          ddl,
          foreignKeys: ddl ? parseForeignKeysFromCreate(ddl) : [],
        });
      }),
    },
    "/api/tables/:name/indices": {
      GET: withAuth(async req => {
        const tableNameParam = req.params.name;
        if (!tableNameParam) {
          return json({ error: "Table name is required" }, 400);
        }
        const tableName = decodeURIComponent(tableNameParam);
        const indexList = await db.execute(`PRAGMA index_list(${quoteIdentifier(tableName)})`);
        const indices = await Promise.all(
          indexList.rows.map(async indexRow => {
            const indexName = String(indexRow.name ?? "");
            const indexSql = await db.execute({
              sql: "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
              args: [indexName],
            });
            const columnsResult = await db.execute(`PRAGMA index_info(${quoteIdentifier(indexName)})`);
            return {
              name: indexName,
              unique: Boolean(indexRow.unique),
              origin: String(indexRow.origin ?? "unknown"),
              partial: Boolean(indexRow.partial),
              sql: (indexSql.rows[0]?.sql as string | null | undefined) ?? null,
              columns: columnsResult.rows.map(item => String(item.name ?? "")),
            };
          }),
        );

        return json({
          table: tableName,
          indices,
        });
      }),
    },
    "/api/query": {
      POST: withAuth(async req => {
        const body = await parseJsonBody<{ sql?: string; allowWrite?: boolean }>(req);
        const sqlText = body.sql?.trim() ?? "";
        const allowWrite = body.allowWrite === true;

        if (!sqlText) {
          return json({ error: "SQL is required" }, 400);
        }
        if (!allowWrite && !isReadonlyQuery(sqlText)) {
          return json({ error: "Only read-only queries are allowed by default." }, 400);
        }

        const started = performance.now();
        const result = await db.execute(sqlText);
        const durationMs = Number((performance.now() - started).toFixed(2));

        return json({
          columns: result.columns,
          rows: result.rows.map(normalizeRow),
          rowsAffected: result.rowsAffected,
          durationMs,
        });
      }),
    },
    "/api/export": {
      POST: withAuth(async req => {
        const body = await parseJsonBody<{
          table?: string;
          format?: "csv" | "json";
          limit?: number;
          sort?: SortInput[];
        }>(req);

        const tableName = body.table?.trim();
        if (!tableName) {
          return json({ error: "table is required" }, 400);
        }

        const format = body.format === "json" ? "json" : "csv";
        const limit = clampInt(String(body.limit ?? 1000), 1000, 1, 10000);
        const sort = body.sort?.[0];
        const orderBySql = sort?.id ? ` ORDER BY ${quoteIdentifier(sort.id)} ${sort.desc ? "DESC" : "ASC"}` : "";

        const result = await db.execute(`SELECT * FROM ${quoteIdentifier(tableName)}${orderBySql} LIMIT ${limit}`);
        const rows = result.rows.map(normalizeRow);
        const baseName = `${tableName}-${Date.now()}`;

        if (format === "json") {
          const data = JSON.stringify(rows, null, 2);
          return new Response(data, {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Disposition": `attachment; filename="${baseName}.json"`,
            },
          });
        }

        const csv = toCsv(result.columns, rows);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${baseName}.csv"`,
          },
        });
      }),
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

const entryUrl = `http://${cli.host}:${selectedPort}/?token=${sessionToken}`;
console.log(`\n${APP_NAME} v${APP_VERSION}`);
console.log(`Database: ${dbPath}`);
console.log(`Listening on: ${entryUrl}`);
console.log(`SQLite docs: https://www.sqlite.org/docs.html\n`);

if (cli.open) {
  openBrowser(entryUrl);
}

process.on("SIGINT", () => {
  server.stop(true);
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop(true);
  db.close();
  process.exit(0);
});

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    host: "127.0.0.1",
    port: DEFAULT_PORT,
    open: true,
    dbPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) continue;

    if (current === "--help" || current === "-h") {
      printHelpAndExit(0);
    }

    if (current === "--open") {
      options.open = true;
      continue;
    }

    if (current === "--no-open") {
      options.open = false;
      continue;
    }

    if (current === "--host") {
      const value = argv[index + 1];
      if (!value) {
        printHelpAndExit(1, "--host requires a value");
      }
      options.host = value;
      index += 1;
      continue;
    }

    if (current === "--port") {
      const value = argv[index + 1];
      if (!value) {
        printHelpAndExit(1, "--port requires a value");
      }
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
        printHelpAndExit(1, `Invalid --port value: ${value}`);
      }
      options.port = numeric;
      index += 1;
      continue;
    }

    if (current.startsWith("-")) {
      printHelpAndExit(1, `Unknown option: ${current}`);
    }

    if (!options.dbPath) {
      options.dbPath = current;
      continue;
    }

    printHelpAndExit(1, `Unexpected argument: ${current}`);
  }

  if (!options.dbPath) {
    printHelpAndExit(1, "A database path is required.");
  }

  return options;
}

function printHelpAndExit(exitCode: number, message?: string): never {
  if (message) {
    console.error(message);
    console.error("");
  }

  console.log(`${APP_NAME} — local SQLite browser (libSQL driver)

Usage:
  bun src/index.ts [options] <database-path>
  ${APP_NAME} [options] <database-path>

Options:
  --host <host>    Bind address (default: 127.0.0.1)
  --port <port>    Preferred port (default: 4983)
  --open           Open browser on start (default)
  --no-open        Do not open browser
  --help, -h       Show this help

Examples:
  ${APP_NAME} ./app.db
  ${APP_NAME} --port 4983 ./app.db`);

  process.exit(exitCode);
}

async function findAvailablePort(host: string, startPort: number): Promise<number> {
  for (let candidate = startPort; candidate < startPort + 20; candidate += 1) {
    if (await isPortFree(host, candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + 19}`);
}

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = createServer();
    probe.unref();
    probe.on("error", () => resolve(false));
    probe.listen({ host, port }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function createSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function isAuthorized(req: Request, token: string): boolean {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken === token) {
    return true;
  }

  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ") && authHeader.slice("Bearer ".length) === token) {
    return true;
  }

  return false;
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

function parseJsonSafe<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clampInt(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, numeric));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function isReadonlyQuery(sql: string): boolean {
  return /^(select|with|pragma|explain|values)\b/i.test(sql.trimStart());
}

function buildWhereClause(filters: FilterInput[]): { whereSql: string; args: string[] } {
  const normalizedFilters = filters.filter(item => item.id && item.value.trim().length > 0);
  if (normalizedFilters.length === 0) {
    return {
      whereSql: "",
      args: [],
    };
  }

  const clauses: string[] = [];
  const args: string[] = [];

  for (const filter of normalizedFilters) {
    clauses.push(`LOWER(CAST(${quoteIdentifier(filter.id)} AS TEXT)) LIKE ?`);
    args.push(`%${filter.value.trim().toLowerCase()}%`);
  }

  return {
    whereSql: ` WHERE ${clauses.join(" AND ")}`,
    args,
  };
}

function normalizeRow(row: Row): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeValue(value);
  }
  return normalized;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString("hex")}`;
  }
  return value;
}

async function listCustomTypes(client: ReturnType<typeof createClient>): Promise<string[]> {
  try {
    const result = await client.execute("PRAGMA list_types");
    return result.rows
      .map(row => String(row.name ?? row.type ?? "").trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function readSchema(client: ReturnType<typeof createClient>): Promise<SchemaObject[]> {
  const schemaRows = await client.execute(
    // Hide sqlite/system tables and libSQL-internal names (prefix used by some libSQL builds).
    "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_%' ORDER BY type, name",
  );

  const objects = await Promise.all(
    schemaRows.rows.map(async row => {
      const name = String(row.name ?? "");
      const type = row.type === "view" ? "view" : "table";
      const sql = typeof row.sql === "string" ? row.sql : null;
      const columns = type === "table" ? await readTableColumns(client, name) : [];

      let rowCount: number | null = null;
      if (type === "table") {
        try {
          const countResult = await client.execute(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(name)}`);
          const countValue = countResult.rows[0]?.total;
          rowCount = typeof countValue === "number" ? countValue : Number(countValue ?? 0);
        } catch {
          rowCount = null;
        }
      }

      return {
        name,
        type,
        sql,
        rowCount,
        columns,
        foreignKeys: sql ? parseForeignKeysFromCreate(sql) : [],
      } satisfies SchemaObject;
    }),
  );

  return objects;
}

async function readTableColumns(client: ReturnType<typeof createClient>, tableName: string): Promise<TableColumn[]> {
  const result = await client.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return result.rows.map(row => ({
    cid: Number(row.cid ?? 0),
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    notnull: Number(row.notnull ?? 0),
    dflt_value: row.dflt_value == null ? null : String(row.dflt_value),
    pk: Number(row.pk ?? 0),
  }));
}

function parseForeignKeysFromCreate(createStatement: string): ForeignKeyInfo[] {
  const found: ForeignKeyInfo[] = [];
  const regex =
    /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+("?[A-Za-z0-9_\.]+"?)\s*\(([^)]+)\)\s*(?:ON\s+DELETE\s+(CASCADE|RESTRICT|NO ACTION|SET NULL|SET DEFAULT))?\s*(?:ON\s+UPDATE\s+(CASCADE|RESTRICT|NO ACTION|SET NULL|SET DEFAULT))?/gi;

  for (const match of createStatement.matchAll(regex)) {
    const from = match[1]
      ?.split(",")
      .map(value => value.trim().replaceAll('"', ""))
      .filter(Boolean);
    const toColumns = match[3]
      ?.split(",")
      .map(value => value.trim().replaceAll('"', ""))
      .filter(Boolean);

    found.push({
      from: from ?? [],
      toTable: match[2]?.replaceAll('"', "") ?? "",
      toColumns: toColumns ?? [],
      onDelete: match[4] ?? null,
      onUpdate: match[5] ?? null,
    });
  }

  return found;
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const escape = (value: unknown): string => {
    if (value == null) {
      return "";
    }
    const text = String(value).replaceAll('"', '""');
    return /[",\n]/.test(text) ? `"${text}"` : text;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map(column => escape(row[column])).join(","));
  }
  return lines.join("\n");
}

function openBrowser(url: string) {
  const platform = process.platform;

  if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}
