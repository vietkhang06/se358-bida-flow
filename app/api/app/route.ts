import { summarizeTableStatuses } from "@/lib/live-sync";
import { effectiveTableStatus } from "@/lib/operation-validation";
import {
  DEFAULT_REPORT_TIMEZONE,
  localDateInTimeZone,
  queryReportSnapshot,
  resolveDayRangeUtc,
  resolveReportFilter,
} from "@/lib/reporting";
import { sessionTiming, queryAll, queryOne, requireUser, responseError } from "@/lib/server";

function allowed(user: Awaited<ReturnType<typeof requireUser>>, permission: string) {
  return user.roleCode === "ADMIN" || user.permissions.includes(permission);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const canSeeTables = allowed(user, "TABLES_VIEW");
    const canSeeOrders = allowed(user, "ORDERS_MANAGE");
    const canSeeCatalog = canSeeOrders || allowed(user, "PRODUCTS_MANAGE") || allowed(user, "INVENTORY_MANAGE");
    const canManageReservations = allowed(user, "RESERVATIONS_MANAGE");
    const canSeat = allowed(user, "SESSIONS_MANAGE");
    const canSeeAccounts = allowed(user, "USERS_MANAGE") || allowed(user, "ROLES_MANAGE");
    const canSeeCustomers = allowed(user, "CUSTOMERS_MANAGE") || allowed(user, "MEMBERSHIPS_MANAGE");
    const canSeeInvoices = allowed(user, "INVOICES_VIEW") || allowed(user, "INVOICES_MANAGE") || allowed(user, "PAYMENTS_MANAGE");
    const canSeeShifts = allowed(user, "SHIFTS_MANAGE") || allowed(user, "SHIFTS_HISTORY");
    const canAdmin = allowed(user, "USERS_MANAGE") || allowed(user, "ROLES_MANAGE") || allowed(user, "TABLES_MANAGE") || allowed(user, "PRICES_MANAGE");

    const [areas, tableTypes, priceRules, tables, sessions, reservations, categories, products, orders, orderItems, customers, tiers, invoices, invoiceItems, payments, inventory, shifts, users, roles, permissionRows, auditLogs] = await Promise.all([
      canSeeTables || canAdmin ? queryAll("SELECT * FROM areas WHERE active = 1 ORDER BY sort_order, name") : [],
      canSeeTables || canAdmin ? queryAll("SELECT * FROM table_types WHERE active = 1 ORDER BY name") : [],
      canAdmin ? queryAll(`SELECT pr.*, tt.name AS type_name FROM price_rules pr JOIN table_types tt ON tt.id=pr.table_type_id WHERE pr.active=1 ORDER BY tt.name, pr.priority DESC, pr.start_minute`) : [],
      canSeeTables || canAdmin ? queryAll(`SELECT bt.*, a.name AS area_name, tt.name AS type_name, tt.color AS type_color, tt.base_hourly_rate,
        EXISTS (SELECT 1 FROM play_sessions ps WHERE ps.table_id=bt.id AND ps.status IN ('ACTIVE','PAUSED')) AS has_session,
        EXISTS (SELECT 1 FROM reservations r WHERE r.table_id=bt.id AND r.status IN ('PENDING','CONFIRMED') AND julianday(r.starts_at)<=julianday('now') AND julianday(r.ends_at)>julianday('now')) AS has_booking
        FROM billiard_tables bt JOIN areas a ON a.id = bt.area_id JOIN table_types tt ON tt.id = bt.table_type_id
        WHERE bt.active = 1 ORDER BY a.sort_order, bt.sort_order, bt.name`) : [],
      canSeeTables ? queryAll(`SELECT ps.*, bt.name AS table_name, c.full_name AS customer_name
        FROM play_sessions ps JOIN billiard_tables bt ON bt.id = ps.table_id LEFT JOIN customers c ON c.id = ps.customer_id
        WHERE ps.status IN ('ACTIVE','PAUSED') OR (ps.status='CLOSED' AND ps.ended_at >= datetime('now','-7 day') AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.session_id=ps.id AND i.status<>'CANCELLED'))
        ORDER BY ps.started_at DESC`) : [],
      (canManageReservations || canSeat) ? queryAll(`SELECT r.*, bt.name AS table_name FROM reservations r
        JOIN billiard_tables bt ON bt.id = r.table_id WHERE julianday(r.starts_at) >= julianday('now','-1 day') AND (?=1 OR r.status='CONFIRMED') ORDER BY r.starts_at`, canManageReservations ? 1 : 0) : [],
      canSeeCatalog || canAdmin ? queryAll("SELECT * FROM product_categories WHERE active = 1 ORDER BY sort_order, name") : [],
      canSeeCatalog || canAdmin ? queryAll(`SELECT p.*, pc.name AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE p.active = 1 ORDER BY pc.sort_order, p.name`) : [],
      canSeeOrders ? queryAll(`SELECT o.*, ps.table_id, bt.name AS table_name FROM orders o JOIN play_sessions ps ON ps.id = o.session_id
        JOIN billiard_tables bt ON bt.id = ps.table_id WHERE o.status='OPEN' OR julianday(o.updated_at)>=julianday('now','-7 day') ORDER BY o.created_at DESC`) : [],
      canSeeOrders ? queryAll(`SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status='OPEN' OR julianday(o.updated_at)>=julianday('now','-7 day') ORDER BY oi.created_at`) : [],
      canSeeCustomers ? queryAll(`SELECT c.*, m.id AS membership_id, m.points, mt.name AS tier_name, mt.discount_percent
        FROM customers c LEFT JOIN memberships m ON m.customer_id = c.id AND m.active = 1 LEFT JOIN membership_tiers mt ON mt.id = m.tier_id
        WHERE c.active = 1 ORDER BY c.full_name`) : [],
      canSeeCustomers || canAdmin ? queryAll("SELECT * FROM membership_tiers WHERE active = 1 ORDER BY min_points") : [],
      canSeeInvoices ? queryAll(`SELECT i.*, c.full_name AS customer_name, bt.name AS table_name,
        COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_amount
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN play_sessions ps ON ps.id = i.session_id
        LEFT JOIN billiard_tables bt ON bt.id = ps.table_id ORDER BY i.created_at DESC LIMIT 150`) : [],
      canSeeInvoices ? queryAll("SELECT * FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices ORDER BY created_at DESC LIMIT 150)") : [],
      canSeeInvoices ? queryAll("SELECT * FROM payments ORDER BY paid_at DESC LIMIT 200") : [],
      allowed(user, "INVENTORY_MANAGE") ? queryAll(`SELECT it.*, p.name AS product_name, u.full_name AS created_by_name
        FROM inventory_transactions it JOIN products p ON p.id = it.product_id JOIN users u ON u.id = it.created_by ORDER BY it.created_at DESC LIMIT 200`) : [],
      canSeeShifts ? queryAll(`SELECT ws.*, u.full_name AS cashier_name, cu.full_name AS closed_by_name
        FROM work_shifts ws JOIN users u ON u.id = ws.cashier_id LEFT JOIN users cu ON cu.id = ws.closed_by ORDER BY ws.opened_at DESC LIMIT 100`) : [],
      canSeeAccounts ? queryAll(`SELECT u.id, u.email, u.username, u.full_name, u.phone, u.status, u.last_login_at, u.created_at,
        r.id AS role_id, r.code AS role_code, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`) : [],
      canSeeAccounts ? queryAll("SELECT * FROM roles ORDER BY name") : [],
      allowed(user, "ROLES_MANAGE") ? queryAll(`SELECT p.id, p.code, p.name, p.module, rp.role_id
        FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id ORDER BY p.module, p.name`) : [],
      allowed(user, "AUDIT_VIEW") ? queryAll(`SELECT al.*, u.full_name AS actor_name FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id ORDER BY al.created_at DESC LIMIT 250`) : [],
    ]);

    const sampledAt = new Date();
    const enrichedSessions = await Promise.all((sessions as Array<Record<string, unknown>>).map(async (session) => {
      const timing = await sessionTiming(String(session.id), sampledAt);
      return { ...session, live_table_amount: session.status === "CLOSED" ? session.table_amount : timing.amount,
        billable_seconds: timing.seconds, sampled_at: timing.sampledAt };
    }));
    const visibleTables = (tables as Array<Record<string, unknown>>).map((table) => ({
      ...table, status: effectiveTableStatus(table as { status: string }),
    }));

    const tableSummary = summarizeTableStatuses(visibleTables);
    const canViewReports = allowed(user, "REPORTS_VIEW");
    const url = new URL(request.url);
    const reportFilter = canViewReports
      ? resolveReportFilter({
          from: url.searchParams.get("reportFrom") ?? url.searchParams.get("from"),
          to: url.searchParams.get("reportTo") ?? url.searchParams.get("to"),
          tz: url.searchParams.get("reportTz") ?? url.searchParams.get("tz"),
          now: sampledAt,
        })
      : null;

    const businessTz = reportFilter?.timezone ?? DEFAULT_REPORT_TIMEZONE;
    const todayRange = resolveDayRangeUtc(localDateInTimeZone(sampledAt, businessTz), businessTz);

    const [report, summary] = await Promise.all([
      reportFilter ? queryReportSnapshot(reportFilter) : Promise.resolve(null),
      queryOne<Record<string, number>>(
        `SELECT
          (SELECT COUNT(*) FROM billiard_tables WHERE active=1) AS table_count,
          (SELECT COUNT(*) FROM billiard_tables WHERE status='PLAYING' AND active=1) AS playing_count,
          (SELECT COUNT(*) FROM reservations WHERE status IN ('PENDING','CONFIRMED')
            AND julianday(starts_at) >= julianday(?) AND julianday(starts_at) < julianday(?)) AS reservation_count,
          (SELECT COALESCE(SUM(total_amount),0) FROM invoices WHERE status='PAID' AND paid_at IS NOT NULL
            AND julianday(paid_at) >= julianday(?) AND julianday(paid_at) < julianday(?)) AS today_revenue,
          (SELECT COUNT(*) FROM products WHERE active=1 AND track_stock=1 AND stock_quantity <= min_stock) AS low_stock_count,
          (SELECT COUNT(*) FROM orders WHERE status='OPEN') AS open_orders_count`,
        todayRange.startUtc,
        todayRange.endExclusiveUtc,
        todayRange.startUtc,
        todayRange.endExclusiveUtc,
      ),
    ]);

    return Response.json({
      user, summary: {
        table_count: canSeeTables ? tableSummary.total : undefined,
        playing_count: canSeeTables ? tableSummary.playing : undefined,
        available_count: canSeeTables ? tableSummary.available : undefined,
        reserved_count: canSeeTables ? tableSummary.reserved : undefined,
        maintenance_count: canSeeTables ? tableSummary.maintenance : undefined,
        open_orders_count: canSeeOrders ? summary?.open_orders_count : undefined,
        snapshot_at: sampledAt.toISOString(),

        reservation_count: canManageReservations || canSeat ? summary?.reservation_count : undefined,
        today_revenue: canViewReports ? summary?.today_revenue : undefined,
        low_stock_count: allowed(user, "INVENTORY_MANAGE") ? summary?.low_stock_count : undefined,
      }, areas, tableTypes, priceRules, tables: visibleTables, sessions: enrichedSessions, reservations,
      categories, products, orders, orderItems, customers, tiers, invoices, invoiceItems, payments,
      inventory, shifts, users, roles, permissionRows, auditLogs, report,
      reportMeta: reportFilter
        ? {
            from: reportFilter.from,
            to: reportFilter.to,
            timezone: reportFilter.timezone,
            startUtc: reportFilter.startUtc,
            endExclusiveUtc: reportFilter.endExclusiveUtc,
            dayCount: reportFilter.dayCount,
          }
        : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
