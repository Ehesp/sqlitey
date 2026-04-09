/// <reference path="../bun-env.d.ts" />

import type { CompletionContext } from "@codemirror/autocomplete";
import { autocompletion } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ColumnDef, ColumnSizingState, SortingState } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import CodeMirror from "@uiw/react-codemirror";
import { Command as CommandPrimitive } from "cmdk";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  LockIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  Table2Icon,
  TerminalSquareIcon,
  UnlockIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SQL_EDITOR_KEYWORDS } from "@/lib/sql-keywords";
import "./index.css";

type MetaResponse = {
  name: string;
  version: string;
  dialect: string;
  dbPath: string;
  docs: string;
  customTypes: string[];
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

type SchemaResponse = {
  objects: SchemaObject[];
};

type RowsResponse = {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  page: {
    limit: number;
    offset: number;
    total: number;
  };
};

type DdlResponse = {
  table: string;
  type: "table" | "view";
  ddl: string | null;
  foreignKeys: ForeignKeyInfo[];
};

type IndicesResponse = {
  table: string;
  indices: Array<{
    name: string;
    unique: boolean;
    origin: string;
    partial: boolean;
    sql: string | null;
    columns: string[];
  }>;
};

type QueryResponse = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number;
  durationMs: number;
};

type PaginationToken = number | "left-ellipsis" | "right-ellipsis";

const TOKEN_STORAGE_KEY = "sqlitey_token";

function readTokenFromBrowser(): string {
  const url = new URL(window.location.href);
  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromStorage = sessionStorage.getItem(TOKEN_STORAGE_KEY);

  if (tokenFromQuery) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, tokenFromQuery);
    url.searchParams.delete("token");
    const nextSearch = url.search ? `${url.search}` : "";
    window.history.replaceState({}, "", `${url.pathname}${nextSearch}${url.hash}`);
    return tokenFromQuery;
  }

  return tokenFromStorage ?? "";
}

function buildPaginationTokens(currentPage: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "right-ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "left-ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "left-ellipsis", currentPage - 1, currentPage, currentPage + 1, "right-ellipsis", totalPages];
}

function buildQueryResultCsv(columns: string[], rows: Record<string, unknown>[]): string {
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

function buildQueryResultTsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [
    columns.join("\t"),
    ...rows.map(row => columns.map(columnName => String(row[columnName] ?? "")).join("\t")),
  ].join("\n");
}

function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function App() {
  const [token] = useState<string>(() => readTokenFromBrowser());
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [schema, setSchema] = useState<SchemaObject[]>([]);
  const [schemaSearch, setSchemaSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [rowsResponse, setRowsResponse] = useState<RowsResponse | null>(null);
  const [ddlResponse, setDdlResponse] = useState<DdlResponse | null>(null);
  const [indicesResponse, setIndicesResponse] = useState<IndicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [querySheetOpen, setQuerySheetOpen] = useState(false);
  const [queryAllowWrite, setQueryAllowWrite] = useState(false);
  const [querySql, setQuerySql] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [queryResultPageIndex, setQueryResultPageIndex] = useState(0);
  const [queryResultPageSize, setQueryResultPageSize] = useState(50);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [sqlWorkspaceSplitPct, setSqlWorkspaceSplitPct] = useState(50);
  const sqlWorkspaceRowRef = useRef<HTMLDivElement>(null);
  const [ddlCopyFeedback, setDdlCopyFeedback] = useState(false);
  const ddlCopyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tableHeaderTransformRef = useRef<HTMLDivElement>(null);
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const selectedTableInfo = useMemo(
    () => schema.find(item => item.name === selectedTable) ?? null,
    [schema, selectedTable],
  );

  const filteredSchema = useMemo(() => {
    const normalized = schemaSearch.trim().toLowerCase();
    if (!normalized) {
      return schema;
    }
    return schema.filter(item => item.name.toLowerCase().includes(normalized));
  }, [schema, schemaSearch]);

  const filterEntries = useMemo(
    () =>
      Object.entries(columnFilters)
        .map(([id, value]) => ({ id, value: value.trim() }))
        .filter(item => item.value.length > 0),
    [columnFilters],
  );

  const apiFetch = useCallback(
    async (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Content-Type", "application/json");
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(input, {
        ...init,
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const text = await response.text();
        let message = text.trim() || `Request failed (${response.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            message = parsed.error;
          } else if (typeof parsed.message === "string" && parsed.message.trim()) {
            message = parsed.message;
          }
        } catch {
          /* body is not JSON */
        }
        throw new Error(message);
      }

      return response;
    },
    [token],
  );

  const apiGet = useCallback(
    async <T,>(path: string): Promise<T> => {
      const response = await apiFetch(path, { method: "GET" });
      return (await response.json()) as T;
    },
    [apiFetch],
  );

  const refreshSchemaAndMeta = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [metaPayload, schemaPayload] = await Promise.all([
        apiGet<MetaResponse>("/api/meta"),
        apiGet<SchemaResponse>("/api/schema"),
      ]);
      setMeta(metaPayload);
      setSchema(schemaPayload.objects);

      setSelectedTable(current => {
        if (!current || !schemaPayload.objects.some(item => item.name === current)) {
          const firstTable = schemaPayload.objects.find(item => item.type === "table") ?? schemaPayload.objects[0];
          return firstTable?.name ?? null;
        }
        return current;
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setLoading(false);
    }
  }, [apiGet]);

  useEffect(() => {
    void refreshSchemaAndMeta();
  }, [refreshSchemaAndMeta]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(current => !current);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setQuerySheetOpen(current => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!selectedTable) {
      return;
    }

    const sizingStorageKey = `sqlitey_column_sizing_${selectedTable}`;
    const rawSizing = localStorage.getItem(sizingStorageKey);
    if (!rawSizing) {
      setColumnSizing({});
      return;
    }
    try {
      const parsed = JSON.parse(rawSizing) as ColumnSizingState;
      setColumnSizing(parsed);
    } catch {
      setColumnSizing({});
    }
  }, [selectedTable]);

  useEffect(() => {
    if (!selectedTable) {
      return;
    }
    const sizingStorageKey = `sqlitey_column_sizing_${selectedTable}`;
    localStorage.setItem(sizingStorageKey, JSON.stringify(columnSizing));
  }, [columnSizing, selectedTable]);

  const fetchRows = useCallback(async () => {
    if (!selectedTable) {
      return;
    }

    setRowsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(pageIndex * pageSize),
      sort: JSON.stringify(sorting),
      filters: JSON.stringify(filterEntries),
    });

    try {
      const payload = await apiGet<RowsResponse>(`/api/tables/${encodeURIComponent(selectedTable)}/rows?${params}`);
      setRowsResponse(payload);
      setSelectedRow(null);
      setSelectedRowId(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setRowsLoading(false);
    }
  }, [apiGet, filterEntries, pageIndex, pageSize, selectedTable, sorting]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    if (!selectedTable) {
      return;
    }

    setDdlResponse(null);
    setIndicesResponse(null);
    setInspectorLoading(true);
    setError(null);

    const loadInspectorData = async () => {
      try {
        const [ddlPayload, indicesPayload] = await Promise.all([
          apiGet<DdlResponse>(`/api/tables/${encodeURIComponent(selectedTable)}/ddl`),
          apiGet<IndicesResponse>(`/api/tables/${encodeURIComponent(selectedTable)}/indices`),
        ]);
        setDdlResponse(ddlPayload);
        setIndicesResponse(indicesPayload);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      } finally {
        setInspectorLoading(false);
      }
    };

    void loadInspectorData();
  }, [apiGet, selectedTable]);

  useEffect(() => {
    if (!selectedTable) {
      return;
    }
    setQuerySql(prev =>
      prev.trim().length === 0 ? `SELECT * FROM "${selectedTable}" LIMIT 100;` : prev,
    );
  }, [selectedTable]);

  const tableRows = rowsResponse?.rows ?? [];
  const rowColumns = rowsResponse?.columns ?? [];
  const normalizedTableSearch = tableSearch.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalizedTableSearch) {
      return tableRows;
    }
    return tableRows.filter(row =>
      Object.values(row).some(value => String(value ?? "").toLowerCase().includes(normalizedTableSearch)),
    );
  }, [normalizedTableSearch, tableRows]);

  const tableColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const indexColumn: ColumnDef<Record<string, unknown>> = {
      id: "__rowIndex",
      header: "#",
      size: 64,
      minSize: 52,
      maxSize: 90,
      enableSorting: false,
      cell: info => pageIndex * pageSize + info.row.index + 1,
    };

    const mappedColumns: ColumnDef<Record<string, unknown>>[] = rowColumns.map(columnName => ({
      accessorKey: columnName,
      id: columnName,
      size: 220,
      minSize: 120,
      header: columnName,
      enableSorting: true,
      cell: info => renderCellValue(info.getValue()),
    }));

    return [indexColumn, ...mappedColumns];
  }, [pageIndex, pageSize, rowColumns]);

  const table = useReactTable({
    data: visibleRows,
    columns: tableColumns,
    state: { sorting, columnSizing },
    manualSorting: true,
    onSortingChange: updater => {
      setPageIndex(0);
      setSorting(current => (typeof updater === "function" ? updater(current) : updater));
    },
    onColumnSizingChange: updater => {
      setColumnSizing(current => (typeof updater === "function" ? updater(current) : updater));
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const visibleTableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: visibleTableRows.length,
    getScrollElement: () => tableViewportRef.current,
    estimateSize: () => 42,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalPages = Math.max(1, Math.ceil((rowsResponse?.page.total ?? 0) / pageSize));
  const totalTableWidth = table.getTotalSize();
  const currentPage = Math.min(pageIndex + 1, totalPages);
  const paginationTokens = useMemo<PaginationToken[]>(
    () => buildPaginationTokens(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const queryResultRowCount = queryResult?.rows.length ?? 0;
  const queryResultTotalPages = Math.max(1, Math.ceil(queryResultRowCount / queryResultPageSize));
  const queryResultCurrentPage = Math.min(queryResultPageIndex + 1, queryResultTotalPages);
  const queryResultPaginationTokens = useMemo<PaginationToken[]>(
    () => buildPaginationTokens(queryResultCurrentPage, queryResultTotalPages),
    [queryResultCurrentPage, queryResultTotalPages],
  );
  const queryResultPageRows = useMemo(() => {
    if (!queryResult || queryResult.columns.length === 0) {
      return [];
    }
    const start = queryResultPageIndex * queryResultPageSize;
    return queryResult.rows.slice(start, start + queryResultPageSize);
  }, [queryResult, queryResultPageIndex, queryResultPageSize]);

  const syncHeaderTranslateX = useCallback((scrollLeft: number) => {
    const inner = tableHeaderTransformRef.current;
    if (!inner) {
      return;
    }
    inner.style.transform = `translateX(-${scrollLeft}px)`;
  }, []);

  const handleTableViewportScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      syncHeaderTranslateX(event.currentTarget.scrollLeft);
    },
    [syncHeaderTranslateX],
  );

  const handleHeaderStripWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const viewport = tableViewportRef.current;
      if (!viewport) {
        return;
      }
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      viewport.scrollLeft += delta;
      syncHeaderTranslateX(viewport.scrollLeft);
    },
    [syncHeaderTranslateX],
  );

  useLayoutEffect(() => {
    const viewport = tableViewportRef.current;
    syncHeaderTranslateX(viewport?.scrollLeft ?? 0);
  }, [syncHeaderTranslateX, totalTableWidth, selectedTable, rowsLoading]);

  const completionSource = useMemo(
    () => (context: CompletionContext) => {
      const tokenCandidate = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
      if (!tokenCandidate && !context.explicit) {
        return null;
      }

      return {
        from: tokenCandidate?.from ?? context.pos,
        options: SQL_EDITOR_KEYWORDS.map(label => ({
          label,
          type: "keyword" as const,
        })),
      };
    },
    [],
  );

  const sqlEditorExtensions = useMemo(
    () => [sql(), autocompletion({ override: [completionSource] })],
    [completionSource],
  );

  const sqlEditorBasicSetup = useMemo(
    () => ({
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: true,
    }),
    [],
  );

  const onSqlWorkspaceResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const container = sqlWorkspaceRowRef.current;
    if (!container) {
      return;
    }
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = Math.round(((ev.clientX - rect.left) / rect.width) * 100);
      setSqlWorkspaceSplitPct(Math.min(80, Math.max(20, pct)));
    };

    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }, []);

  const runQuery = useCallback(async () => {
    if (!querySql.trim()) {
      setQueryError("Write a SQL statement to run.");
      return;
    }

    setQueryRunning(true);
    setQueryError(null);

    try {
      const response = await apiFetch("/api/query", {
        method: "POST",
        body: JSON.stringify({
          sql: querySql,
          allowWrite: queryAllowWrite,
        }),
      });
      setQueryResult((await response.json()) as QueryResponse);
      setQueryResultPageIndex(0);
    } catch (caughtError) {
      setQueryError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setQueryResult(null);
    } finally {
      setQueryRunning(false);
    }
  }, [apiFetch, queryAllowWrite, querySql]);

  const downloadExport = useCallback(
    async (format: "csv" | "json") => {
      if (!selectedTable) {
        return;
      }

      try {
        const response = await apiFetch("/api/export", {
          method: "POST",
          body: JSON.stringify({
            table: selectedTable,
            format,
            sort: sorting,
            limit: 5000,
          }),
        });
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `${selectedTable}.${format}`;
        anchor.click();
        URL.revokeObjectURL(objectUrl);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      }
    },
    [apiFetch, selectedTable, sorting],
  );

  const copyCurrentPageAsTsv = useCallback(async () => {
    if (!rowsResponse) {
      return;
    }

    const lines = [
      rowsResponse.columns.join("\t"),
      ...visibleRows.map(row => rowsResponse.columns.map(columnName => String(row[columnName] ?? "")).join("\t")),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
  }, [rowsResponse, visibleRows]);

  const exportQueryResult = useCallback(
    (format: "csv" | "json") => {
      if (!queryResult || queryResult.columns.length === 0) {
        return;
      }
      const base = `query-result-${Date.now()}`;
      if (format === "json") {
        downloadTextFile(JSON.stringify(queryResult.rows, null, 2), `${base}.json`, "application/json;charset=utf-8");
      } else {
        downloadTextFile(buildQueryResultCsv(queryResult.columns, queryResult.rows), `${base}.csv`, "text/csv;charset=utf-8");
      }
    },
    [queryResult],
  );

  const copyQueryResultAsTsv = useCallback(async () => {
    if (!queryResult || queryResult.columns.length === 0) {
      return;
    }
    await navigator.clipboard.writeText(buildQueryResultTsv(queryResult.columns, queryResult.rows));
  }, [queryResult]);

  const copyTableDdl = useCallback(async () => {
    const text = ddlResponse?.ddl?.trim();
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (ddlCopyResetTimerRef.current) {
        clearTimeout(ddlCopyResetTimerRef.current);
      }
      setDdlCopyFeedback(true);
      ddlCopyResetTimerRef.current = setTimeout(() => {
        setDdlCopyFeedback(false);
        ddlCopyResetTimerRef.current = null;
      }, 1600);
    } catch {
      /* clipboard unavailable */
    }
  }, [ddlResponse?.ddl]);

  useEffect(() => {
    return () => {
      if (ddlCopyResetTimerRef.current) {
        clearTimeout(ddlCopyResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setDdlCopyFeedback(false);
    if (ddlCopyResetTimerRef.current) {
      clearTimeout(ddlCopyResetTimerRef.current);
      ddlCopyResetTimerRef.current = null;
    }
  }, [ddlResponse?.ddl]);

  return (
    <div className="sql-studio-shell">
      <header className="border-b border-border/70 bg-background/70 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <DatabaseIcon />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-wide text-foreground">sqlitey</h1>
              <p className="truncate text-xs text-muted-foreground">
                {meta?.dbPath ?? "Loading database metadata..."} · {meta?.dialect ?? "libsql (SQLite-compatible)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCommandPaletteOpen(true)}>
              <SparklesIcon data-icon="inline-start" />
              Command
              <kbd className="ml-2 rounded border border-border bg-muted px-1.5 text-[10px]">⌘K</kbd>
            </Button>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setQuerySheetOpen(true)}>
                <TerminalSquareIcon data-icon="inline-start" />
                SQL Workspace
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className={cn(
                  "size-8 shrink-0",
                  queryAllowWrite && "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15",
                )}
                title={
                  queryAllowWrite
                    ? "Read/write: mutating SQL is allowed. Click to lock (read-only)."
                    : "Read-only: only SELECT-style statements. Click to allow writes."
                }
                aria-pressed={queryAllowWrite}
                aria-label={queryAllowWrite ? "Switch to read-only SQL" : "Allow read/write SQL"}
                onClick={() => setQueryAllowWrite(value => !value)}
              >
                {queryAllowWrite ? <UnlockIcon className="size-4" /> : <LockIcon className="size-4" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <main className="h-[calc(100vh-76px)] px-4 py-4">
        <PanelGroup
          id="sql-studio-main-layout"
          orientation="horizontal"
          className="h-full rounded-xl border border-border/70 bg-card/50 shadow-2xl"
        >
          <Panel
            id="panelLeft"
            defaultSize="280px"
            minSize="200px"
            maxSize="440px"
            className="flex min-w-0 flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Table2Icon className="size-4 text-muted-foreground" />
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">Explorer</h2>
              </div>
              <Badge variant="secondary">{schema.length}</Badge>
            </div>
            <div className="px-4 pb-3">
              <Input
                value={schemaSearch}
                onChange={event => setSchemaSearch(event.target.value)}
                placeholder="Filter tables or views..."
              />
            </div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 p-2">
                {filteredSchema.map(item => (
                  <button
                    key={item.name}
                    type="button"
                    className={cn(
                      "w-full rounded-md border border-transparent px-3 py-2 text-left transition-all",
                      selectedTable === item.name
                        ? "border-primary/40 bg-primary/10 shadow-sm"
                        : "hover:border-border hover:bg-accent/40",
                    )}
                    onClick={() => {
                      setSelectedTable(item.name);
                      setPageIndex(0);
                      setColumnFilters({});
                    }}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <Badge variant={item.type === "table" ? "default" : "outline"} className="text-[10px]">
                        {item.type}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{item.columns.length} cols</span>
                      <span>{item.rowCount == null ? "n/a" : `${item.rowCount.toLocaleString()} rows`}</span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </Panel>

          <PanelResizeHandle className="panel-handle" />

          <Panel id="panelCenter" minSize="38%" className="@container flex min-w-0 flex-col">
            <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 @[40rem]:flex-row @[40rem]:items-center @[40rem]:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{selectedTableInfo?.name ?? "Select a table"}</p>
                {selectedTableInfo ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedTableInfo.rowCount == null
                      ? "Row count n/a"
                      : `${selectedTableInfo.rowCount.toLocaleString()} rows`}
                    {" · "}
                    {selectedTableInfo.columns.length} column{selectedTableInfo.columns.length === 1 ? "" : "s"}
                    {" · "}
                    {inspectorLoading
                      ? "…"
                      : `${indicesResponse?.indices.length ?? 0} index${(indicesResponse?.indices.length ?? 0) === 1 ? "" : "es"}`}
                  </p>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 @[40rem]:shrink-0">
                <Input
                  value={tableSearch}
                  onChange={event => setTableSearch(event.target.value)}
                  placeholder="Search current page..."
                  className="h-8 min-w-0 w-full @[40rem]:w-[220px]"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <DownloadIcon data-icon="inline-start" />
                      Export
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => void copyCurrentPageAsTsv()}>Copy as Excel (TSV)</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void downloadExport("csv")}>Download CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void downloadExport("json")}>Download JSON</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" onClick={() => void refreshSchemaAndMeta()}>
                  <RefreshCwIcon data-icon="inline-start" className={cn(loading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                className="border-b border-border/60 bg-muted/25 overflow-x-hidden overflow-y-hidden"
                onWheel={handleHeaderStripWheel}
              >
                <div ref={tableHeaderTransformRef} style={{ width: `${totalTableWidth}px` }}>
                  {table.getHeaderGroups().map(headerGroup => (
                    <div key={headerGroup.id} className="flex">
                      {headerGroup.headers.map(header => {
                        const isIndex = header.column.id === "__rowIndex";
                        return (
                          <div
                            key={header.id}
                            style={{ width: header.getSize() }}
                            className="group/header relative shrink-0 border-r border-border/60 px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase last:border-r-0"
                          >
                            <button
                              type="button"
                              className={cn("inline-flex items-center gap-1", header.column.getCanSort() && "cursor-pointer")}
                              onClick={header.column.getToggleSortingHandler()}
                              disabled={!header.column.getCanSort()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {header.column.getIsSorted() === "asc" && "↑"}
                              {header.column.getIsSorted() === "desc" && "↓"}
                            </button>
                            {!isIndex && (
                              <div
                                className="absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/30"
                                onMouseDown={header.getResizeHandler()}
                                onTouchStart={header.getResizeHandler()}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                  <div className="flex border-t border-border/60 bg-background/80">
                    {table.getAllColumns().map(column => (
                      <div
                        key={column.id}
                        style={{ width: column.getSize() }}
                        className="shrink-0 border-r border-border/60 p-1.5 last:border-r-0"
                      >
                        {column.id === "__rowIndex" ? (
                          <span className="px-1 text-[11px] text-muted-foreground">#</span>
                        ) : (
                          <Input
                            value={columnFilters[column.id] ?? ""}
                            onChange={event => {
                              setColumnFilters(current => ({
                                ...current,
                                [column.id]: event.target.value,
                              }));
                              setPageIndex(0);
                            }}
                            placeholder="Filter..."
                            className="h-7 text-xs"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                ref={tableViewportRef}
                className="min-h-0 min-w-0 flex-1 overflow-auto"
                onScroll={handleTableViewportScroll}
              >
                {rowsLoading ? (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading rows...</div>
                ) : visibleTableRows.length === 0 ? (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">No rows for this page.</div>
                ) : (
                  <div
                    className="relative"
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: `${table.getTotalSize()}px`,
                    }}
                  >
                    {virtualRows.map(virtualItem => {
                      const row = visibleTableRows[virtualItem.index];
                      if (!row) {
                        return null;
                      }
                      const rowIdentifier = `${pageIndex}:${row.id}`;
                      const isSelected = selectedRowId === rowIdentifier;

                      return (
                        <button
                          key={row.id}
                          type="button"
                          className={cn(
                            "absolute left-0 flex h-[42px] w-full border-b border-border/40 text-left transition-colors",
                            isSelected ? "bg-primary/10" : "hover:bg-accent/40",
                          )}
                          style={{
                            transform: `translateY(${virtualItem.start}px)`,
                          }}
                          onClick={() => {
                            setSelectedRow(row.original);
                            setSelectedRowId(rowIdentifier);
                          }}
                        >
                          {row.getVisibleCells().map(cell => (
                            <div
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                              className="shrink-0 truncate border-r border-border/40 px-3 py-2 text-sm last:border-r-0"
                              title={String(cell.getValue() ?? "")}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          ))}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 px-4 py-2 text-sm">
                <div className="min-w-0 shrink text-muted-foreground">
                  Page {currentPage} / {totalPages} · {rowsResponse?.page.total.toLocaleString() ?? 0} total rows
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2 @[28rem]:w-auto @[28rem]:max-w-none @[28rem]:flex-row @[28rem]:flex-wrap @[28rem]:items-center @[28rem]:justify-end">
                  <Select
                    value={String(pageSize)}
                    onValueChange={value => {
                      setPageSize(Number(value));
                      setPageIndex(0);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[90px] shrink-0 self-start @[28rem]:self-center">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                    </SelectContent>
                  </Select>
                  <Pagination className="mx-0 w-full min-w-0 max-w-full justify-start overflow-x-auto overflow-y-hidden @[28rem]:w-auto">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={event => {
                            event.preventDefault();
                            if (pageIndex > 0) {
                              setPageIndex(current => current - 1);
                            }
                          }}
                          className={cn(pageIndex <= 0 && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>

                      {paginationTokens.map(token => (
                        <PaginationItem key={typeof token === "number" ? `page-${token}` : token}>
                          {typeof token === "number" ? (
                            <PaginationLink
                              href="#"
                              isActive={token === currentPage}
                              onClick={event => {
                                event.preventDefault();
                                setPageIndex(token - 1);
                              }}
                            >
                              {token}
                            </PaginationLink>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}

                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={event => {
                            event.preventDefault();
                            if (pageIndex < totalPages - 1) {
                              setPageIndex(current => current + 1);
                            }
                          }}
                          className={cn(pageIndex >= totalPages - 1 && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="panel-handle" />

          <Panel
            id="panelRight"
            defaultSize="304px"
            minSize="240px"
            maxSize="560px"
            className="flex min-w-0 flex-col"
          >
            <Tabs defaultValue="info" className="flex h-full min-h-0 min-w-0 flex-col gap-0">
              <div className="border-b border-border/70 px-4 py-3">
                <TabsList variant="line">
                  <TabsTrigger value="info">Table info</TabsTrigger>
                  <TabsTrigger value="indices">Indices</TabsTrigger>
                  <TabsTrigger value="sql">SQL</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="info" className="min-h-0 min-w-0">
                <ScrollArea className="h-[calc(100vh-172px)] min-w-0 px-4 py-4">
                  {inspectorLoading ? (
                    <p className="text-sm text-muted-foreground">Loading inspector...</p>
                  ) : (
                    <div className="flex flex-col gap-5">
                      <section className="rounded-lg border border-border/70 bg-background/60 p-4">
                        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Table Details</h3>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="text-muted-foreground">Name:</span> {selectedTableInfo?.name ?? "—"}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Type:</span> {selectedTableInfo?.type ?? "—"}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Columns:</span> {selectedTableInfo?.columns.length ?? 0}
                          </p>
                          <p>
                            <span className="text-muted-foreground">Rows:</span>{" "}
                            {selectedTableInfo?.rowCount == null ? "n/a" : selectedTableInfo.rowCount.toLocaleString()}
                          </p>
                        </div>
                      </section>

                      <section className="rounded-lg border border-border/70 bg-background/60 p-4">
                        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Columns</h3>
                        <div className="flex flex-wrap gap-2">
                          {(selectedTableInfo?.columns ?? []).map(column => (
                            <Badge key={column.name} variant={column.pk ? "default" : "secondary"} className="font-mono text-xs">
                              {column.name}: {column.type || "unknown"}
                            </Badge>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-lg border border-border/70 bg-background/60 p-4">
                        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Foreign Keys</h3>
                        {(ddlResponse?.foreignKeys.length ?? 0) === 0 ? (
                          <p className="text-sm text-muted-foreground">No foreign keys parsed.</p>
                        ) : (
                          <div className="space-y-2">
                            {ddlResponse?.foreignKeys.map((foreignKey, index) => (
                              <div key={`${foreignKey.toTable}-${index}`} className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
                                <div className="font-mono">
                                  ({foreignKey.from.join(", ")}) → {foreignKey.toTable}({foreignKey.toColumns.join(", ")})
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  ON DELETE {foreignKey.onDelete ?? "—"} · ON UPDATE {foreignKey.onUpdate ?? "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="rounded-lg border border-border/70 bg-background/60 p-4">
                        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Selected Row Object</h3>
                        {selectedRow ? (
                          <pre className="max-h-[260px] overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
                            {JSON.stringify(selectedRow, null, 2)}
                          </pre>
                        ) : (
                          <p className="text-sm text-muted-foreground">Select a row in the data grid to inspect it here.</p>
                        )}
                      </section>
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="indices" className="min-h-0 min-w-0">
                <ScrollArea className="h-[calc(100vh-172px)] min-w-0 px-4 py-4">
                  <div className="flex min-w-0 flex-col gap-3">
                    {indicesResponse?.indices.length ? (
                      indicesResponse.indices.map(indexEntry => (
                        <section
                          key={indexEntry.name}
                          className="min-w-0 max-w-full rounded-lg border border-border/70 bg-background/60 p-4"
                        >
                          <div className="mb-2 flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <p className="truncate font-medium" title={indexEntry.name}>
                                {indexEntry.name}
                              </p>
                            </div>
                            <Badge className="shrink-0" variant={indexEntry.unique ? "default" : "secondary"}>
                              {indexEntry.unique ? "UNIQUE" : "INDEX"}
                            </Badge>
                          </div>
                          <p className="mb-2 break-words text-xs text-muted-foreground">
                            Origin: {indexEntry.origin} · Partial: {String(indexEntry.partial)}
                          </p>
                          <p className="mb-2 break-words text-xs text-muted-foreground">
                            Columns: {indexEntry.columns.join(", ") || "—"}
                          </p>
                          <pre className="max-h-[220px] min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap break-words">
                            {indexEntry.sql ?? "No SQL definition"}
                          </pre>
                        </section>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No indices detected for this table.</p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="sql" className="min-h-0 min-w-0">
                <ScrollArea className="h-[calc(100vh-172px)] min-w-0 px-4 py-4">
                  <section className="min-w-0 rounded-lg border border-border/70 bg-background/60 p-4">
                    <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">DDL</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-6 shrink-0 p-0"
                        title={ddlCopyFeedback ? "Copied" : "Copy DDL"}
                        disabled={!ddlResponse?.ddl}
                        onClick={() => void copyTableDdl()}
                      >
                        {ddlCopyFeedback ? (
                          <CheckIcon className="size-3.5 text-emerald-400" aria-hidden />
                        ) : (
                          <CopyIcon className="size-3.5" aria-hidden />
                        )}
                        <span className="sr-only">{ddlCopyFeedback ? "Copied to clipboard" : "Copy DDL"}</span>
                      </Button>
                    </div>
                    <pre className="max-h-[420px] overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
                      {ddlResponse?.ddl ?? "No CREATE SQL available."}
                    </pre>
                  </section>
                  <section className="mt-4 rounded-lg border border-border/70 bg-background/60 p-4">
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Custom Types</h3>
                    {meta?.customTypes.length ? (
                      <div className="flex flex-wrap gap-2">
                        {meta.customTypes.map(customType => (
                          <Badge key={customType} variant="secondary">
                            {customType}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No custom types from PRAGMA list_types (libSQL extension).</p>
                    )}
                  </section>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </Panel>
        </PanelGroup>
      </main>

      <Dialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
        <DialogContent className="max-w-xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Command Palette</DialogTitle>
            <DialogDescription>Jump between tables and quick actions.</DialogDescription>
          </DialogHeader>

          <CommandPrimitive className="overflow-hidden rounded-lg border border-border/60 bg-background">
            <div className="flex items-center border-b px-3">
              <SearchIcon className="size-4 text-muted-foreground" />
              <CommandPrimitive.Input className="h-11 w-full border-0 bg-transparent px-3 text-sm outline-none" placeholder="Type a command or table name..." />
            </div>
            <CommandPrimitive.List className="max-h-[380px] overflow-auto p-2">
              <CommandPrimitive.Empty className="p-4 text-sm text-muted-foreground">No matching command.</CommandPrimitive.Empty>

              <CommandPrimitive.Group heading="Navigation" className="px-2 py-2 text-xs text-muted-foreground">
                <CommandPrimitive.Item
                  onSelect={() => {
                    setQuerySheetOpen(true);
                    setCommandPaletteOpen(false);
                  }}
                  className="cursor-pointer rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                >
                  Open SQL Workspace
                </CommandPrimitive.Item>
                <CommandPrimitive.Item
                  onSelect={() => {
                    void refreshSchemaAndMeta();
                    setCommandPaletteOpen(false);
                  }}
                  className="cursor-pointer rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                >
                  Refresh metadata and schema
                </CommandPrimitive.Item>
              </CommandPrimitive.Group>

              <CommandPrimitive.Separator className="my-2 h-px bg-border" />

              <CommandPrimitive.Group heading="Tables" className="px-2 py-2 text-xs text-muted-foreground">
                {schema
                  .filter(item => item.type === "table")
                  .map(item => (
                    <CommandPrimitive.Item
                      key={item.name}
                      onSelect={() => {
                        setSelectedTable(item.name);
                        setPageIndex(0);
                        setCommandPaletteOpen(false);
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                    >
                      <span>{item.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {item.rowCount == null ? "n/a" : item.rowCount}
                      </Badge>
                    </CommandPrimitive.Item>
                  ))}
              </CommandPrimitive.Group>
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>

      {querySheetOpen && (
        <div aria-hidden className="fixed inset-0 z-40 bg-black/50" role="presentation" />
      )}
      <Sheet modal={false} open={querySheetOpen} onOpenChange={setQuerySheetOpen}>
        <SheetContent side="bottom" className="flex h-[72vh] max-w-full flex-col p-0">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4 pt-12">
            <div
              ref={sqlWorkspaceRowRef}
              className="flex min-h-0 w-full min-w-0 flex-1 flex-row"
            >
              <div
                className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border/70"
                style={{
                  flexGrow: sqlWorkspaceSplitPct,
                  flexShrink: 1,
                  flexBasis: 0,
                  minWidth: "20%",
                  maxWidth: "80%",
                }}
              >
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="text-sm font-medium">Query Editor</p>
                <Button size="sm" onClick={() => void runQuery()} disabled={queryRunning}>
                  <PlayIcon data-icon="inline-start" />
                  {queryRunning ? "Running..." : "Execute"}
                </Button>
              </div>
              {queryAllowWrite && (
                <p className="border-b border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-100/90">
                  Read/write mode: DDL and data changes are allowed for this workspace.
                </p>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <CodeMirror
                  value={querySql}
                  height="100%"
                  theme="dark"
                  extensions={sqlEditorExtensions}
                  onChange={value => setQuerySql(value)}
                  basicSetup={sqlEditorBasicSetup}
                />
              </div>
              </div>

              <div
                className="panel-handle mx-2 w-1 shrink-0 cursor-col-resize touch-none select-none"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize query editor and result panels"
                onPointerDown={onSqlWorkspaceResizePointerDown}
              />

              <div
                className="@container flex min-h-0 min-w-0 flex-col rounded-lg border border-border/70"
                style={{
                  flexGrow: 100 - sqlWorkspaceSplitPct,
                  flexShrink: 1,
                  flexBasis: 0,
                  minWidth: "20%",
                  maxWidth: "80%",
                }}
              >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Query Result</p>
                  {queryResult && (
                    <p className="text-xs text-muted-foreground">
                      {queryResult.rows.length} rows · {queryResult.durationMs.toFixed(2)} ms
                    </p>
                  )}
                </div>
                {queryResult && queryResult.columns.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <DownloadIcon data-icon="inline-start" />
                        Export
                        <ChevronDownIcon data-icon="inline-end" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void copyQueryResultAsTsv()}>Copy as Excel (TSV)</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => exportQueryResult("csv")}>Download CSV</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportQueryResult("json")}>Download JSON</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  {queryError ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{queryError}</p>
                  ) : queryResult ? (
                    queryResult.columns.length > 0 ? (
                      <div className="overflow-auto rounded-md border border-border/60">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40">
                            <tr>
                              {queryResult.columns.map(column => (
                                <th key={column} className="border-b border-r border-border/60 px-2 py-1.5 text-left font-medium last:border-r-0">
                                  {column}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {queryResultPageRows.map((row, rowIndex) => {
                              const absoluteIndex = queryResultPageIndex * queryResultPageSize + rowIndex;
                              return (
                                <tr key={`result-row-${absoluteIndex}`} className="odd:bg-muted/20">
                                  {queryResult.columns.map(column => (
                                    <td key={`${absoluteIndex}-${column}`} className="max-w-[260px] truncate border-b border-r border-border/50 px-2 py-1.5 last:border-r-0">
                                      {String(row[column] ?? "null")}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Statement completed. {queryResult.rowsAffected} rows affected.
                      </p>
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">Run a SQL command to view result data here.</p>
                  )}
                </div>

                {queryResult && queryResult.columns.length > 0 && queryResultRowCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/70 px-3 py-2 text-sm">
                    <div className="min-w-0 shrink text-muted-foreground">
                      Page {queryResultCurrentPage} / {queryResultTotalPages} · {queryResultRowCount.toLocaleString()} rows
                    </div>
                    <div className="flex w-full min-w-0 flex-col gap-2 @[28rem]:w-auto @[28rem]:max-w-none @[28rem]:flex-row @[28rem]:flex-wrap @[28rem]:items-center @[28rem]:justify-end">
                      <Select
                        value={String(queryResultPageSize)}
                        onValueChange={value => {
                          setQueryResultPageSize(Number(value));
                          setQueryResultPageIndex(0);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[90px] shrink-0 self-start @[28rem]:self-center">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="25">25</SelectItem>
                          <SelectItem value="50">50</SelectItem>
                          <SelectItem value="100">100</SelectItem>
                          <SelectItem value="200">200</SelectItem>
                        </SelectContent>
                      </Select>
                      <Pagination className="mx-0 w-full min-w-0 max-w-full justify-start overflow-x-auto overflow-y-hidden @[28rem]:w-auto">
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              href="#"
                              onClick={event => {
                                event.preventDefault();
                                if (queryResultPageIndex > 0) {
                                  setQueryResultPageIndex(current => current - 1);
                                }
                              }}
                              className={cn(queryResultPageIndex <= 0 && "pointer-events-none opacity-50")}
                            />
                          </PaginationItem>

                          {queryResultPaginationTokens.map(token => (
                            <PaginationItem key={typeof token === "number" ? `qr-page-${token}` : token}>
                              {typeof token === "number" ? (
                                <PaginationLink
                                  href="#"
                                  isActive={token === queryResultCurrentPage}
                                  onClick={event => {
                                    event.preventDefault();
                                    setQueryResultPageIndex(token - 1);
                                  }}
                                >
                                  {token}
                                </PaginationLink>
                              ) : (
                                <PaginationEllipsis />
                              )}
                            </PaginationItem>
                          ))}

                          <PaginationItem>
                            <PaginationNext
                              href="#"
                              onClick={event => {
                                event.preventDefault();
                                if (queryResultPageIndex < queryResultTotalPages - 1) {
                                  setQueryResultPageIndex(current => current + 1);
                                }
                              }}
                              className={cn(queryResultPageIndex >= queryResultTotalPages - 1 && "pointer-events-none opacity-50")}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function renderCellValue(value: unknown) {
  if (value == null) {
    return <span className="italic text-muted-foreground">null</span>;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string" && value.length > 180) {
    return `${value.slice(0, 177)}...`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
