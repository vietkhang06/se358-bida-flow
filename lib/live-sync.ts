export const LIVE_POLL_INTERVAL_MS = 10_000;

export type SyncState = "idle" | "syncing" | "error" | "offline";

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export type SyncToken = {
  seq: number;
  signal: AbortSignal;
};

/**
 * Coordinates overlapping /api/app refreshes so background polling never duplicates
 * in-flight requests and stale responses never overwrite newer state or survive logout.
 */
export function createLatestSyncGuard() {
  let latestSeq = 0;
  let activeController: AbortController | null = null;
  let inFlight = false;

  return {
    begin(force = false): SyncToken | null {
      if (inFlight && !force) return null;
      if (activeController) activeController.abort();
      latestSeq += 1;
      const controller = new AbortController();
      activeController = controller;
      inFlight = true;
      return { seq: latestSeq, signal: controller.signal };
    },
    isCurrent(seq: number): boolean {
      return seq === latestSeq && activeController !== null && !activeController.signal.aborted;
    },
    finish(seq: number) {
      if (seq === latestSeq) {
        inFlight = false;
        activeController = null;
      }
    },
    invalidate() {
      latestSeq += 1;
      inFlight = false;
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
    },
    isInFlight() {
      return inFlight;
    },
  };
}

export type ClassifiedSyncError =
  | { kind: "abort" }
  | { kind: "unauthorized"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "server"; message: string };

export function classifySyncError(error: unknown, isOnline = true): ClassifiedSyncError {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return { kind: "abort" };
  }
  if (error instanceof ApiRequestError && error.status === 401) {
    return { kind: "unauthorized", message: error.message || "Phiên đăng nhập đã hết hạn." };
  }
  if (!isOnline || (error instanceof TypeError && /fetch|network|failed/i.test(error.message))) {
    return { kind: "offline", message: "Mất kết nối mạng. Đang hiển thị dữ liệu gần nhất." };
  }
  return {
    kind: "server",
    message: error instanceof Error ? error.message : "Không thể đồng bộ dữ liệu vận hành.",
  };
}

export type TableStatusCounts = {
  total: number;
  available: number;
  playing: number;
  reserved: number;
  maintenance: number;
};

/** Derive summary counts directly from effective table states so KPI cards always match the table grid. */
export function summarizeTableStatuses(tables: Array<{ status?: unknown }>): TableStatusCounts {
  const counts: TableStatusCounts = {
    total: tables.length,
    available: 0,
    playing: 0,
    reserved: 0,
    maintenance: 0,
  };
  for (const table of tables) {
    if (table.status === "PLAYING") counts.playing += 1;
    else if (table.status === "RESERVED") counts.reserved += 1;
    else if (table.status === "MAINTENANCE") counts.maintenance += 1;
    else counts.available += 1;
  }
  return counts;
}
