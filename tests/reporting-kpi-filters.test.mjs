import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, createJsonRequest } from "./helpers/test-fixture.mjs";
import {
  addCalendarDays,
  isValidIanaTimeZone,
  isValidIsoDate,
  localDateInTimeZone,
  parseDbTimestamp,
  resolveReportFilter,
  zonedMidnightUtc,
} from "../lib/reporting.ts";

describe("BF-REPORT-01: Date, timezone, and boundary unit checks", () => {
  test("validates calendar dates including leap years", () => {
    assert.equal(isValidIsoDate("2024-02-29"), true);
    assert.equal(isValidIsoDate("2025-02-29"), false);
    assert.equal(isValidIsoDate("2026-04-31"), false);
    assert.equal(isValidIsoDate("2026-13-01"), false);
    assert.equal(isValidIsoDate("2026-11-10"), true);
  });

  test("validates IANA timezones and converts midnight boundaries accurately", () => {
    assert.equal(isValidIanaTimeZone("Asia/Ho_Chi_Minh"), true);
    assert.equal(isValidIanaTimeZone("UTC"), true);
    assert.equal(isValidIanaTimeZone("Mars/Olympus"), false);
    assert.equal(isValidIanaTimeZone("GMT+7"), false);

    assert.equal(zonedMidnightUtc("2026-11-10", "Asia/Ho_Chi_Minh").toISOString(), "2026-11-09T17:00:00.000Z");
    assert.equal(zonedMidnightUtc("2026-01-01", "Asia/Ho_Chi_Minh").toISOString(), "2025-12-31T17:00:00.000Z");
    assert.equal(addCalendarDays("2025-12-31", 1), "2026-01-01");
  });

  test("parses SQLite CURRENT_TIMESTAMP and ISO UTC strings consistently", () => {
    const a = parseDbTimestamp("2026-11-09 17:00:00");
    const b = parseDbTimestamp("2026-11-09T17:00:00.000Z");
    assert.ok(a && b);
    assert.equal(a.getTime(), b.getTime());
    assert.equal(localDateInTimeZone(a, "Asia/Ho_Chi_Minh"), "2026-11-10");
    assert.equal(localDateInTimeZone(a, "UTC"), "2026-11-09");
  });

  test("resolveReportFilter handles defaults, single-day, and rejects invalid ranges", () => {
    const now = new Date("2026-11-09T18:30:00.000Z"); // 2026-11-10 01:30 in Asia/Ho_Chi_Minh
    const def = resolveReportFilter({ now });
    assert.equal(def.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(def.to, "2026-11-10");
    assert.equal(def.from, "2026-10-12");
    assert.equal(def.dayCount, 30);

    const single = resolveReportFilter({ from: "2026-11-10", now });
    assert.equal(single.from, "2026-11-10");
    assert.equal(single.to, "2026-11-10");
    assert.equal(single.startUtc, "2026-11-09T17:00:00.000Z");
    assert.equal(single.endExclusiveUtc, "2026-11-10T17:00:00.000Z");

    assert.throws(() => resolveReportFilter({ from: "2026-11-11", to: "2026-11-10" }), /Ngày bắt đầu/);
    assert.throws(() => resolveReportFilter({ from: "2025-02-29", to: "2025-03-01" }), /không hợp lệ/);
    assert.throws(() => resolveReportFilter({ from: "2025-01-01", to: "2026-06-01" }), /tối đa/);
    assert.throws(() => resolveReportFilter({ tz: "Invalid/Zone" }), /Múi giờ/);
  });
});

describe("BF-REPORT-01: API KPI calculations, timezone boundaries, and RBAC", () => {
  let fixture;

  beforeEach(async () => {
    fixture = await setupTestEnvironment();
  });

  afterEach(() => {
    fixture.db._raw.close();
  });

  async function seedReportDataset(db) {
    await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a1', 'K1', 'Khu 1')").run();
    await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt1', 'POOL', 'Pool', 60000)").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('t1', 'B1', 'Bàn 1', 'a1', 'tt1', 'AVAILABLE')").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('t2', 'B2', 'Bàn 2', 'a1', 'tt1', 'AVAILABLE')").run();

    await db.prepare("INSERT INTO product_categories (id, code, name) VALUES ('cat1', 'DRINK', 'Đồ uống')").run();
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, stock_quantity, track_stock) VALUES ('p1', 'STING', 'Sting dâu', 'cat1', 'PRODUCT', 'Chai', 20000, 112, 1)").run();
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, stock_quantity, track_stock) VALUES ('p2', 'COKE', 'Coca Cola', 'cat1', 'PRODUCT', 'Lon', 15000, 50, 1)").run();

    // Closed session on t1 on 2026-11-10 ICT: 60m elapsed (02:00Z->03:00Z), 20m pause (02:15Z->02:35Z) => 40m billable, 40,000 VND
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, started_at, ended_at, status, table_amount, opened_by, closed_by) VALUES ('s_in', 'PS-1', 't1', '2026-11-10T02:00:00.000Z', '2026-11-10T03:00:00.000Z', 'CLOSED', 40000, 'usr_cashier', 'usr_cashier')"
    ).run();
    await db.prepare(
      "INSERT INTO session_segments (id, session_id, table_id, started_at, ended_at, hourly_rate, amount) VALUES ('seg_in', 's_in', 't1', '2026-11-10T02:00:00.000Z', '2026-11-10T03:00:00.000Z', 60000, 40000)"
    ).run();
    await db.prepare(
      "INSERT INTO session_pauses (id, session_id, segment_id, started_at, ended_at, reason, created_by) VALUES ('pau_in', 's_in', 'seg_in', '2026-11-10T02:15:00.000Z', '2026-11-10T02:35:00.000Z', 'Nghỉ', 'usr_cashier')"
    ).run();

    // Closed session on t2 outside 2026-11-10 ICT (2026-11-09 16:30Z = 23:30 ICT 2026-11-09)
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, started_at, ended_at, status, table_amount, opened_by, closed_by) VALUES ('s_prev', 'PS-0', 't2', '2026-11-09T15:30:00.000Z', '2026-11-09T16:30:00.000Z', 'CLOSED', 60000, 'usr_cashier', 'usr_cashier')"
    ).run();

    // Orders for product grouping check
    await db.prepare("INSERT INTO orders (id, code, session_id, status, created_by) VALUES ('o_in', 'OD-1', 's_in', 'COMPLETED', 'usr_service')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_1', 'o_in', 'p1', 'Sting dâu', 2, 20000, 'SERVED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_2', 'o_in', 'p2', 'Coca Cola', 1, 15000, 'SERVED')").run();

    // Invoice A: 2026-11-09 16:59:59 UTC (SQLite CURRENT_TIMESTAMP format) => 2026-11-09 23:59:59 ICT
    await db.prepare(
      "INSERT INTO invoices (id, code, session_id, status, table_amount, service_amount, discount_amount, surcharge_amount, total_amount, paid_at, created_by) VALUES ('inv_a', 'HD-A', 's_prev', 'PAID', 60000, 0, 0, 0, 60000, '2026-11-09 16:59:59', 'usr_cashier')"
    ).run();

    // Invoice B: 2026-11-09T17:00:00.000Z => 2026-11-10 00:00:00 ICT (exact start of 2026-11-10 ICT!)
    // table=100000, service=50000, discount=15000, surcharge=5000 => net total_amount = 140000
    await db.prepare(
      "INSERT INTO invoices (id, code, status, table_amount, service_amount, discount_amount, surcharge_amount, total_amount, paid_at, created_by) VALUES ('inv_b', 'HD-B', 'PAID', 100000, 50000, 15000, 5000, 140000, '2026-11-09T17:00:00.000Z', 'usr_cashier')"
    ).run();
    await db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES ('ii_b1', 'inv_b', 'PRODUCT', 'oi_1', 'Sting dâu', 2, 20000, 40000)").run();
    await db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES ('ii_b2', 'inv_b', 'PRODUCT', 'oi_2', 'Coca Cola', 1, 10000, 10000)").run();

    // Invoice C: 2026-11-10 16:59:59 UTC => 2026-11-10 23:59:59 ICT (last second of 2026-11-10 ICT!)
    await db.prepare(
      "INSERT INTO invoices (id, code, session_id, status, table_amount, service_amount, discount_amount, surcharge_amount, total_amount, paid_at, created_by) VALUES ('inv_c', 'HD-C', 's_in', 'PAID', 40000, 20000, 0, 0, 60000, '2026-11-10 16:59:59', 'usr_cashier')"
    ).run();
    await db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, source_id, description, quantity, unit_price, amount) VALUES ('ii_c1', 'inv_c', 'PRODUCT', 'oi_1', 'Sting dâu', 1, 20000, 20000)").run();

    // Invoice D: 2026-11-10T17:00:00.000Z => 2026-11-11 00:00:00 ICT (must be excluded from 2026-11-10!)
    await db.prepare(
      "INSERT INTO invoices (id, code, status, table_amount, service_amount, discount_amount, surcharge_amount, total_amount, paid_at, created_by) VALUES ('inv_d', 'HD-D', 'PAID', 90000, 0, 0, 0, 90000, '2026-11-10T17:00:00.000Z', 'usr_cashier')"
    ).run();

    // Invoice E: CANCELLED on 2026-11-10 ICT (must be excluded!)
    await db.prepare(
      "INSERT INTO invoices (id, code, status, table_amount, service_amount, total_amount, paid_at, cancelled_at, cancel_reason, created_by) VALUES ('inv_e', 'HD-E', 'CANCELLED', 80000, 0, 80000, '2026-11-10T05:00:00.000Z', '2026-11-10T05:05:00.000Z', 'Test hủy', 'usr_cashier')"
    ).run();

    // Invoice F: ISSUED (partially paid, not PAID) on 2026-11-10 ICT (must be excluded!)
    await db.prepare(
      "INSERT INTO invoices (id, code, status, table_amount, service_amount, total_amount, issued_at, created_by) VALUES ('inv_f', 'HD-F', 'ISSUED', 70000, 0, 70000, '2026-11-10T06:00:00.000Z', 'usr_cashier')"
    ).run();
    await db.prepare(
      "INSERT INTO payments (id, invoice_id, method, amount, received_by, paid_at) VALUES ('pay_f', 'inv_f', 'BANK_TRANSFER', 30000, 'usr_cashier', '2026-11-10 06:05:00')"
    ).run();

    // Inventory transactions: IN=20, SALE=5, ADJUST(15->12 = -3) inside 2026-11-10 ICT; IN=100 outside
    await db.prepare(
      "INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reason, created_by, created_at) VALUES ('it_1', 'NK-1', 'p1', 'IN', 20, 0, 20, 'Nhập trong kỳ', 'usr_warehouse', '2026-11-10 01:00:00')"
    ).run();
    await db.prepare(
      "INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reason, created_by, created_at) VALUES ('it_2', 'XK-1', 'p1', 'SALE', 5, 20, 15, 'Bán trong kỳ', 'usr_service', '2026-11-10 02:00:00')"
    ).run();
    await db.prepare(
      "INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reason, created_by, created_at) VALUES ('it_3', 'DC-1', 'p1', 'ADJUST', 3, 15, 12, 'Kiểm kê', 'usr_warehouse', '2026-11-10 03:00:00')"
    ).run();
    await db.prepare(
      "INSERT INTO inventory_transactions (id, code, product_id, type, quantity, before_quantity, after_quantity, reason, created_by, created_at) VALUES ('it_out', 'NK-2', 'p1', 'IN', 100, 12, 112, 'Nhập ngày hôm sau', 'usr_warehouse', '2026-11-10 18:00:00')"
    ).run();
  }

  test("filters accurately across Asia/Ho_Chi_Minh midnight boundaries and excludes cancelled/unpaid invoices", async () => {
    await seedReportDataset(fixture.db);

    const res = await fixture.appRoute.GET(
      createJsonRequest(
        "http://localhost:3000/api/app?reportFrom=2026-11-10&reportTo=2026-11-10&reportTz=Asia/Ho_Chi_Minh",
        "GET",
        null,
        fixture.managerCookie,
      ),
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.deepEqual(body.reportMeta.from, "2026-11-10");
    assert.deepEqual(body.reportMeta.to, "2026-11-10");
    assert.deepEqual(body.reportMeta.timezone, "Asia/Ho_Chi_Minh");

    // Independent expected calculation: Invoice B (140,000) + Invoice C (60,000) = 200,000 net
    assert.equal(body.report.revenue.length, 1);
    assert.deepEqual(body.report.revenue[0], {
      day: "2026-11-10",
      invoice_count: 2,
      revenue: 200000,
      table_revenue: 140000,
      service_revenue: 70000,
      discount_amount: 15000,
      surcharge_amount: 5000,
    });

    // Tables: only t1 had session in 2026-11-10 ICT; 60m elapsed minus 20m pause = 40 billable minutes
    const t1 = body.report.tables.find((t) => t.id === "t1");
    const t2 = body.report.tables.find((t) => t.id === "t2");
    assert.equal(t1.session_count, 1);
    assert.equal(t1.revenue, 40000);
    assert.equal(t1.minutes, 40);
    assert.equal(t1.elapsed_minutes, 60);
    assert.equal(t2.session_count, 0);
    assert.equal(t2.revenue, 0);

    // Products: Sting dâu = 2*20000 + 1*20000 = 3 qty, 60000 rev; Coca = 1 qty, 10000 rev
    assert.deepEqual(body.report.products, [
      { name: "Sting dâu", quantity: 3, revenue: 60000 },
      { name: "Coca Cola", quantity: 1, revenue: 10000 },
    ]);

    // Inventory: Sting imported=20, exported=5, adjusted=-3, stock_quantity=112
    const stingInv = body.report.inventory.find((p) => p.name === "Sting dâu");
    assert.deepEqual(stingInv, {
      name: "Sting dâu",
      stock_quantity: 112,
      min_stock: 0,
      imported: 20,
      exported: 5,
      adjusted: -3,
    });
  });

  test("re-buckets the exact same invoices properly when timezone is UTC", async () => {
    await seedReportDataset(fixture.db);

    const res = await fixture.appRoute.GET(
      createJsonRequest(
        "http://localhost:3000/api/app?reportFrom=2026-11-09&reportTo=2026-11-09&reportTz=UTC",
        "GET",
        null,
        fixture.managerCookie,
      ),
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    // In UTC on 2026-11-09: Invoice A (16:59:59Z, 60k) + Invoice B (17:00:00Z, 140k) = 200,000 across 2 invoices
    assert.equal(body.report.revenue.length, 1);
    assert.equal(body.report.revenue[0].day, "2026-11-09");
    assert.equal(body.report.revenue[0].invoice_count, 2);
    assert.equal(body.report.revenue[0].revenue, 200000);
  });

  test("rejects invalid filter inputs with 400 and hides reports for non-REPORTS_VIEW roles", async () => {
    for (const query of [
      "reportFrom=2026-11-11&reportTo=2026-11-10",
      "reportFrom=2025-02-29&reportTo=2025-03-01",
      "reportFrom=2026-11-01&reportTo=2026-11-02&reportTz=Mars/Base",
    ]) {
      const badRes = await fixture.appRoute.GET(
        createJsonRequest(`http://localhost:3000/api/app?${query}`, "GET", null, fixture.managerCookie),
      );
      assert.equal(badRes.status, 400, `Expected 400 for ${query}`);
    }

    const cashierRes = await fixture.appRoute.GET(
      createJsonRequest(
        "http://localhost:3000/api/app?reportFrom=2026-11-10&reportTo=2026-11-10&reportTz=Asia/Ho_Chi_Minh",
        "GET",
        null,
        fixture.cashierCookie,
      ),
    );
    assert.equal(cashierRes.status, 200);
    const cashierBody = await cashierRes.json();
    assert.equal(cashierBody.report, null);
    assert.equal(cashierBody.reportMeta, null);
    assert.equal(cashierBody.summary.today_revenue, undefined);
  });
});
