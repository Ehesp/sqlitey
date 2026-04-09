# localsql-studio

Local, single-user SQLite browser built with Bun + React. It uses `@libsql/client` with `file:` URLs, so it works with ordinary SQLite database files and any libSQL-compatible setup.

It provides:

- schema explorer (tables/views/columns/row counts)
- paginated data grid with virtualization
- right-side inspector (table info, indices, DDL/FKs)
- SQL workspace with keyword autocomplete
- JSON/CSV export and TSV copy

## 1) Install

```bash
bun install
```

## 2) Create a sample database

Using the standard SQLite CLI:

```bash
sqlite3 ./app.db "
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

INSERT INTO users(name, email) VALUES
  ('Avery Quinn', 'avery@acme.dev'),
  ('Jordan Park', 'jordan@acme.dev');
"
```

SQLite documentation: https://www.sqlite.org/docs.html

## 3) Run

### CLI (global install optional)

```bash
bun run studio -- ./app.db
```

or:

```bash
bun src/index.ts ./app.db
```

### Dev mode

```bash
bun run dev
```

Dev mode defaults to `./app.db`.

## 4) Command usage

```bash
bun src/index.ts [options] <database-path>
```

Options:

- `--host <host>` (default: `127.0.0.1`)
- `--port <port>` (default: `4983`)
- `--open` / `--no-open`

Example:

```bash
bun src/index.ts --port 4983 ./app.db
```
