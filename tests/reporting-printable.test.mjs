import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupTestEnvironment, createJsonRequest } from "./helpers/test-fixture.mjs";

let fixture;

beforeEach(async () => {
  fixture = await setupTestEnvironment();
});

describe("BF-REPORT-02: Export Printable Reports and Invoices", () => {
  test("Report snapshot contains complete metrics for printable export", async () => {
    const { appRoute, managerCookie, server } = fixture;
    const db = server.getRawDb();

    // Seed test data for report
    await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a_rep', 'KV_REP', 'Khu Báo Cáo')").run();
    await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt_rep', 'REP_TYPE', 'Bàn Tiêu Chuẩn', 60000)").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_rep', 'REP1', 'Bàn R1', 'a_rep', 'tt_rep', 'AVAILABLE')").run();

    const now = new Date().toISOString();
    await db.prepare("INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_rep', 'PS-REP', 'tbl_rep', 'usr_manager', 'CLOSED', ?, ?, 120000)").bind(now, now).run();

    await db.prepare("INSERT INTO invoices (id, code, session_id, status, table_amount, service_amount, total_amount, paid_at, created_by) VALUES ('inv_rep', 'HD-REP', 'ses_rep', 'PAID', 120000, 30000, 150000, ?, 'usr_manager')").bind(now).run();
    await db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, description, quantity, unit_price, amount) VALUES ('ii_table', 'inv_rep', 'TABLE', 'Tiền bàn', 1, 120000, 120000)").run();
    await db.prepare("INSERT INTO invoice_items (id, invoice_id, source_type, description, quantity, unit_price, amount) VALUES ('ii_drink', 'inv_rep', 'PRODUCT', 'Nước suối Aquafina', 3, 10000, 30000)").run();
    await db.prepare("INSERT INTO payments (id, invoice_id, method, amount, reference, received_by) VALUES ('pay_rep', 'inv_rep', 'CASH', 150000, 'TIEN_MAT_HD_REP', 'usr_manager')").run();

    const res = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, managerCookie));
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(body.report, "Manager must receive report data");
    assert.ok(Array.isArray(body.report.revenue), "Revenue report must be an array");
    assert.ok(Array.isArray(body.report.tables), "Tables report must be an array");
    assert.ok(Array.isArray(body.report.products), "Products report must be an array");
    assert.ok(Array.isArray(body.report.inventory), "Inventory report must be an array");

    // Verify revenue figures
    const todayRevenue = body.report.revenue.find((r) => r.revenue >= 150000);
    assert.ok(todayRevenue, "Should reflect today's paid invoice revenue");
    assert.equal(todayRevenue.table_revenue, 120000);
    assert.equal(todayRevenue.service_revenue, 30000);

    // Verify invoice items for printable invoice
    const inv = body.invoices.find((i) => i.id === "inv_rep");
    assert.ok(inv);
    assert.equal(inv.code, "HD-REP");
    assert.equal(inv.total_amount, 150000);
    assert.equal(inv.paid_amount, 150000);
    assert.equal(inv.status, "PAID");

    const items = body.invoiceItems.filter((item) => item.invoice_id === "inv_rep");
    assert.equal(items.length, 2);
  });

  test("Print stylesheet defines @media print with margins, page break rules, and element suppression", () => {
    const cssPath = path.resolve(process.cwd(), "app/globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");

    assert.match(cssContent, /@media\s+print\s*\{/, "Must contain @media print block");
    assert.match(cssContent, /@page\s*\{[^}]*margin:\s*12mm;/, "Must define @page margin");
    assert.match(cssContent, /display:\s*none\s*!important/, "Must hide interactive non-print elements");
    assert.match(cssContent, /break-inside:\s*avoid/, "Must enforce break-inside: avoid for cards and table rows");
    assert.match(cssContent, /table\s*\{[^}]*width:\s*100%\s*!important/, "Tables must span full print width");
  });
});
