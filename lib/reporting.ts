import { billableSeconds } from "@/lib/play-time";
import { AppError, queryAll } from "@/lib/server";

export const DEFAULT_REPORT_TIMEZONE = "Asia/Ho_Chi_Minh";
export const MAX_REPORT_RANGE_DAYS = 366;

export type ReportFilter = {
  from: string;
  to: string;
  timezone: string;
  startUtc: string;
  endExclusiveUtc: string;
  dayCount: number;
};

export type RevenueDayRow = {
  day: string;
  invoice_count: number;
  revenue: number;
  table_revenue: number;
  service_revenue: number;
  discount_amount: number;
  surcharge_amount: number;
};

export type TableReportRow = {
  id: string;
  name: string;
  session_count: number;
  revenue: number;
  minutes: number;
  elapsed_minutes: number;
};

export type ProductReportRow = {
  name: string;
  quantity: number;
  revenue: number;
};

export type InventoryReportRow = {
  name: string;
  stock_quantity: number;
  min_stock: number;
  imported: number;
  exported: number;
  adjusted: number;
};

export type ReportSnapshot = {
  revenue: RevenueDayRow[];
  tables: TableReportRow[];
  products: ProductReportRow[];
  inventory: InventoryReportRow[];
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IANA_ZONE_RE = /^(?:UTC|Etc\/UTC|Etc\/GMT(?:[+-](?:1[0-4]|[0-9]))?|[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/;
const SQLITE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || !IANA_ZONE_RE.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function addCalendarDays(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + deltaDays)).toISOString().slice(0, 10);
}

export function localDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function zonedWallParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Convert local YYYY-MM-DD 00:00:00.000 in `timeZone` into an exact UTC Date. */
export function zonedMidnightUtc(isoDate: string, timeZone: string): Date {
  if (!isValidIsoDate(isoDate)) throw new AppError("Ngày lọc báo cáo không hợp lệ (định dạng YYYY-MM-DD).", 400);
  if (!isValidIanaTimeZone(timeZone)) throw new AppError("Múi giờ báo cáo không hợp lệ.", 400);
  const [year, month, day] = isoDate.split("-").map(Number);
  const targetUtcWall = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guess = targetUtcWall;
  for (let i = 0; i < 3; i += 1) {
    const wall = zonedWallParts(new Date(guess), timeZone);
    const observedUtcWall = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, 0);
    const diff = targetUtcWall - observedUtcWall;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

export function parseDbTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = SQLITE_DATETIME_RE.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function resolveDayRangeUtc(isoDate: string, timeZone = DEFAULT_REPORT_TIMEZONE) {
  const startUtc = zonedMidnightUtc(isoDate, timeZone).toISOString();
  const endExclusiveUtc = zonedMidnightUtc(addCalendarDays(isoDate, 1), timeZone).toISOString();
  return { startUtc, endExclusiveUtc };
}

/** Validate and resolve report date bounds and business timezone for reporting queries. */
export function resolveReportFilter(input: {
  from?: string | null;
  to?: string | null;
  tz?: string | null;
  now?: Date;
}): ReportFilter {
  const timezone = (input.tz ?? "").trim() || DEFAULT_REPORT_TIMEZONE;
  if (!isValidIanaTimeZone(timezone)) {
    throw new AppError("Múi giờ báo cáo không hợp lệ.", 400);
  }
  const now = input.now ?? new Date();
  const today = localDateInTimeZone(now, timezone);

  const rawFrom = (input.from ?? "").trim();
  const rawTo = (input.to ?? "").trim();

  let from: string;
  let to: string;
  if (!rawFrom && !rawTo) {
    to = today;
    from = addCalendarDays(today, -29);
  } else {
    from = rawFrom || rawTo;
    to = rawTo || rawFrom;
  }

  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new AppError("Ngày lọc báo cáo không hợp lệ (định dạng YYYY-MM-DD).", 400);
  }
  if (from > to) {
    throw new AppError("Ngày bắt đầu không được lớn hơn ngày kết thúc.", 400);
  }

  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  const dayCount = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (dayCount > MAX_REPORT_RANGE_DAYS) {
    throw new AppError(`Khoảng thời gian báo cáo tối đa là ${MAX_REPORT_RANGE_DAYS} ngày.`, 400);
  }

  const startUtc = zonedMidnightUtc(from, timezone).toISOString();
  const endExclusiveUtc = zonedMidnightUtc(addCalendarDays(to, 1), timezone).toISOString();

  return { from, to, timezone, startUtc, endExclusiveUtc, dayCount };
}

type RawPaidInvoice = {
  total_amount: number;
  table_amount: number;
  service_amount: number;
  discount_amount: number;
  surcharge_amount: number;
  paid_at: string;
};

/** Group paid invoices by local calendar day in `filter.timezone`. */
export function aggregateDailyRevenue(rows: RawPaidInvoice[], filter: ReportFilter): RevenueDayRow[] {
  const startMs = Date.parse(filter.startUtc);
  const endMs = Date.parse(filter.endExclusiveUtc);
  const buckets = new Map<string, RevenueDayRow>();

  for (const row of rows) {
    const paidAt = parseDbTimestamp(row.paid_at);
    if (!paidAt) continue;
    const ms = paidAt.getTime();
    if (ms < startMs || ms >= endMs) continue;
    const day = localDateInTimeZone(paidAt, filter.timezone);
    const current = buckets.get(day) ?? {
      day,
      invoice_count: 0,
      revenue: 0,
      table_revenue: 0,
      service_revenue: 0,
      discount_amount: 0,
      surcharge_amount: 0,
    };
    current.invoice_count += 1;
    current.revenue += Number(row.total_amount ?? 0);
    current.table_revenue += Number(row.table_amount ?? 0);
    current.service_revenue += Number(row.service_amount ?? 0);
    current.discount_amount += Number(row.discount_amount ?? 0);
    current.surcharge_amount += Number(row.surcharge_amount ?? 0);
    buckets.set(day, current);
  }

  return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
}

type RawTable = { id: string; name: string };
type RawClosedSession = { id: string; table_id: string; started_at: string; ended_at: string; table_amount: number };
type RawSegment = { id: string; session_id: string; started_at: string; ended_at: string | null };
type RawPause = { session_id: string; segment_id: string; started_at: string; ended_at: string | null };

/** Aggregate closed session performance per table with pause-excluded billable minutes. */
export function aggregateTablePerformance(
  tables: RawTable[],
  sessions: RawClosedSession[],
  segments: RawSegment[],
  pauses: RawPause[],
): TableReportRow[] {
  const segmentsBySession = new Map<string, RawSegment[]>();
  for (const seg of segments) {
    const list = segmentsBySession.get(seg.session_id) ?? [];
    list.push(seg);
    segmentsBySession.set(seg.session_id, list);
  }
  const pausesBySession = new Map<string, RawPause[]>();
  for (const pause of pauses) {
    const list = pausesBySession.get(pause.session_id) ?? [];
    list.push(pause);
    pausesBySession.set(pause.session_id, list);
  }

  const acc = new Map<string, { id: string; name: string; session_count: number; revenue: number; billableSeconds: number; elapsedSeconds: number }>();
  for (const table of tables) {
    acc.set(table.id, {
      id: table.id,
      name: table.name,
      session_count: 0,
      revenue: 0,
      billableSeconds: 0,
      elapsedSeconds: 0,
    });
  }

  for (const session of sessions) {
    const target = acc.get(session.table_id);
    if (!target) continue;
    const endedAt = parseDbTimestamp(session.ended_at);
    const startedAt = parseDbTimestamp(session.started_at);
    if (!endedAt || !startedAt) continue;

    target.session_count += 1;
    target.revenue += Number(session.table_amount ?? 0);
    target.elapsedSeconds += Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);

    const sessionSegments = segmentsBySession.get(session.id) ?? [];
    const sessionPauses = pausesBySession.get(session.id) ?? [];
    if (sessionSegments.length > 0) {
      for (const seg of sessionSegments) {
        const segPauses = sessionPauses.filter((p) => p.segment_id === seg.id);
        target.billableSeconds += billableSeconds(seg, segPauses, endedAt);
      }
    } else {
      target.billableSeconds += billableSeconds(
        { started_at: session.started_at, ended_at: session.ended_at },
        sessionPauses,
        endedAt,
      );
    }
  }

  return [...acc.values()]
    .map((item) => ({
      id: item.id,
      name: item.name,
      session_count: item.session_count,
      revenue: item.revenue,
      minutes: Math.round((item.billableSeconds / 60) * 10) / 10,
      elapsed_minutes: Math.round((item.elapsedSeconds / 60) * 10) / 10,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.minutes - a.minutes || a.name.localeCompare(b.name, "vi"));
}

/** Query and compute all reporting KPI datasets for the requested period and timezone. */
export async function queryReportSnapshot(filter: ReportFilter): Promise<ReportSnapshot> {
  const { startUtc, endExclusiveUtc } = filter;

  const [paidInvoices, tables, closedSessions, segments, pauses, products, inventory] = await Promise.all([
    queryAll<RawPaidInvoice>(
      `SELECT total_amount, table_amount, service_amount, discount_amount, surcharge_amount, paid_at
       FROM invoices
       WHERE status = 'PAID' AND paid_at IS NOT NULL
         AND julianday(paid_at) >= julianday(?) AND julianday(paid_at) < julianday(?)
       ORDER BY paid_at ASC`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<RawTable>(
      `SELECT bt.id, bt.name
       FROM billiard_tables bt
       JOIN areas a ON a.id = bt.area_id
       WHERE bt.active = 1
          OR EXISTS (
            SELECT 1 FROM play_sessions ps
            WHERE ps.table_id = bt.id AND ps.status = 'CLOSED' AND ps.ended_at IS NOT NULL
              AND julianday(ps.ended_at) >= julianday(?) AND julianday(ps.ended_at) < julianday(?)
          )
       ORDER BY a.sort_order, bt.sort_order, bt.name`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<RawClosedSession>(
      `SELECT ps.id, ps.table_id, ps.started_at, ps.ended_at, ps.table_amount
       FROM play_sessions ps
       WHERE ps.status = 'CLOSED' AND ps.ended_at IS NOT NULL
         AND julianday(ps.ended_at) >= julianday(?) AND julianday(ps.ended_at) < julianday(?)`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<RawSegment>(
      `SELECT ss.id, ss.session_id, ss.started_at, ss.ended_at
       FROM session_segments ss
       JOIN play_sessions ps ON ps.id = ss.session_id
       WHERE ps.status = 'CLOSED' AND ps.ended_at IS NOT NULL
         AND julianday(ps.ended_at) >= julianday(?) AND julianday(ps.ended_at) < julianday(?)
       ORDER BY ss.started_at`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<RawPause>(
      `SELECT sp.session_id, sp.segment_id, sp.started_at, sp.ended_at
       FROM session_pauses sp
       JOIN play_sessions ps ON ps.id = sp.session_id
       WHERE ps.status = 'CLOSED' AND ps.ended_at IS NOT NULL
         AND julianday(ps.ended_at) >= julianday(?) AND julianday(ps.ended_at) < julianday(?)`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<ProductReportRow>(
      `SELECT MAX(ii.description) AS name, SUM(ii.quantity) AS quantity, SUM(ii.amount) AS revenue
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN order_items oi ON oi.id = ii.source_id
       WHERE i.status = 'PAID' AND i.paid_at IS NOT NULL
         AND julianday(i.paid_at) >= julianday(?) AND julianday(i.paid_at) < julianday(?)
         AND ii.source_type IN ('PRODUCT', 'SERVICE')
       GROUP BY COALESCE(oi.product_id, ii.description)
       ORDER BY revenue DESC, quantity DESC, name ASC
       LIMIT 20`,
      startUtc,
      endExclusiveUtc,
    ),
    queryAll<InventoryReportRow>(
      `SELECT p.name, p.stock_quantity, p.min_stock,
         COALESCE(SUM(CASE WHEN it.type = 'IN' THEN it.quantity ELSE 0 END), 0) AS imported,
         COALESCE(SUM(CASE WHEN it.type IN ('OUT', 'SALE') THEN it.quantity ELSE 0 END), 0) AS exported,
         COALESCE(SUM(CASE WHEN it.type = 'ADJUST' THEN (it.after_quantity - it.before_quantity) ELSE 0 END), 0) AS adjusted
       FROM products p
       LEFT JOIN inventory_transactions it
         ON it.product_id = p.id
         AND julianday(it.created_at) >= julianday(?)
         AND julianday(it.created_at) < julianday(?)
       WHERE p.active = 1
          OR EXISTS (
            SELECT 1 FROM inventory_transactions it2
            WHERE it2.product_id = p.id
              AND julianday(it2.created_at) >= julianday(?)
              AND julianday(it2.created_at) < julianday(?)
          )
       GROUP BY p.id
       ORDER BY p.name`,
      startUtc,
      endExclusiveUtc,
      startUtc,
      endExclusiveUtc,
    ),
  ]);

  return {
    revenue: aggregateDailyRevenue(paidInvoices, filter),
    tables: aggregateTablePerformance(tables, closedSessions, segments, pauses),
    products,
    inventory,
  };
}
