import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, createJsonRequest } from "./helpers/test-fixture.mjs";

let fixture;

beforeEach(async () => {
  fixture = await setupTestEnvironment();
});

async function seedBilliardEnvironment(db) {
  await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a_main', 'KV_MAIN', 'Khu Chính')").run();
  await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt_libre', 'LIBRE', 'Bàn Libre', 50000)").run();
  await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_101', 'B101', 'Bàn 101', 'a_main', 'tt_libre', 'AVAILABLE')").run();
  await db.prepare("INSERT INTO product_categories (id, code, name) VALUES ('cat_food', 'MON_AN', 'Món ăn')").run();
  await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, stock_quantity, track_stock) VALUES ('p_mi', 'MI_XAO', 'Mì xào bò', 'cat_food', 'PRODUCT', 'Dĩa', 35000, 20, 1)").run();
  await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, stock_quantity, track_stock) VALUES ('p_coca', 'COCA', 'Coca Cola', 'cat_food', 'PRODUCT', 'Lon', 15000, 50, 1)").run();
}

describe("BF-A13-01: Invoice Generation and Line-Item Calculation", () => {
  test("Cannot create invoice for session that is not CLOSED", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    // Active session
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at) VALUES ('ses_active', 'PS-ACT', 'tbl_101', 'usr_cashier', 'ACTIVE', ?)"
    ).bind(now).run();

    const res = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_active" },
    }, cashierCookie));
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /Cần kết thúc phiên chơi trước khi lập hóa đơn/);
  });

  test("Cannot create duplicate invoice for the same session", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_dup', 'PS-DUP', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 50000)"
    ).bind(now, now).run();

    // First invoice succeeds
    const firstRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_dup" },
    }, cashierCookie));
    assert.equal(firstRes.status, 200);

    // Duplicate invoice attempt fails
    const dupRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_dup" },
    }, cashierCookie));
    assert.equal(dupRes.status, 400);
    const dupJson = await dupRes.json();
    assert.match(dupJson.error, /Phiên chơi đã có hóa đơn/);
  });

  test("Invoice generation accurately calculates line items (table + orders) and adjustments", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    // Closed session with table_amount = 75,000 VND
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_calc', 'PS-CALC', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 75000)"
    ).bind(now, now).run();

    // Order: 2 x Mì xào (70,000 VND), 3 x Coca (45,000 VND), 1 x Cancelled (should be excluded)
    await db.prepare("INSERT INTO orders (id, code, session_id, created_by, status) VALUES ('ord_calc', 'ORD-C', 'ses_calc', 'usr_cashier', 'COMPLETED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_mi', 'ord_calc', 'p_mi', 'Mì xào bò', 2, 35000, 'SERVED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_coca', 'ord_calc', 'p_coca', 'Coca Cola', 3, 15000, 'SERVED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_canc', 'ord_calc', 'p_coca', 'Coca Cola', 1, 15000, 'CANCELLED')").run();

    // Table: 75,000; Service: 70,000 + 45,000 = 115,000; Total = 190,000
    const createRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_calc" },
    }, cashierCookie));
    assert.equal(createRes.status, 200);
    const { data: { invoiceId, total } } = await createRes.json();
    assert.equal(total, 190000);

    const invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.table_amount, 75000);
    assert.equal(invoice.service_amount, 115000);
    assert.equal(invoice.discount_amount, 0);
    assert.equal(invoice.surcharge_amount, 0);
    assert.equal(invoice.total_amount, 190000);
    assert.equal(invoice.status, "ISSUED");

    // Line items verification
    const items = await server.queryAll("SELECT * FROM invoice_items WHERE invoice_id = ?", invoiceId);
    assert.equal(items.length, 3); // 1 table line + 2 served product lines (cancelled excluded)

    // Manual adjustment: Add discount 20,000 VND
    const discRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.adjust",
      payload: { invoiceId, type: "DISCOUNT", amount: 20000, description: "Khách quen giảm giá" },
    }, cashierCookie));
    assert.equal(discRes.status, 200);
    const { data: { total: afterDisc } } = await discRes.json();
    assert.equal(afterDisc, 170000);

    // Manual adjustment: Add surcharge 10,000 VND (phụ thu lễ)
    const surRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.adjust",
      payload: { invoiceId, type: "SURCHARGE", amount: 10000, description: "Phụ thu cuối tuần" },
    }, cashierCookie));
    assert.equal(surRes.status, 200);
    const { data: { total: afterSur } } = await surRes.json();
    assert.equal(afterSur, 180000);

    const updatedInvoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(updatedInvoice.discount_amount, 20000);
    assert.equal(updatedInvoice.surcharge_amount, 10000);
    assert.equal(updatedInvoice.total_amount, 180000);
  });
});

describe("BF-A13-02: Payment Capture and Payment Status Transitions", () => {
  test("Cash payment requires open shift; succeeds and logs cash movement when shift is open", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_cash', 'PS-CSH', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 100000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_cash" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // Attempt cash payment before opening shift -> 400
    const noShiftRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CASH", amount: 100000 },
    }, cashierCookie));
    assert.equal(noShiftRes.status, 400);
    assert.match((await noShiftRes.json()).error, /Bạn cần mở ca trước khi nhận thanh toán tiền mặt/);

    // Open shift
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "shift.open",
      payload: { openingCash: 500000 },
    }, cashierCookie));

    // Cash payment succeeds now
    const payRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CASH", amount: 100000 },
    }, cashierCookie));
    assert.equal(payRes.status, 200);

    // Verify invoice status changed to PAID
    const paidInvoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(paidInvoice.status, "PAID");
    assert.ok(paidInvoice.paid_at);

    // Verify payment record
    const payment = await server.queryOne("SELECT * FROM payments WHERE invoice_id = ?", invoiceId);
    assert.ok(payment);
    assert.equal(payment.amount, 100000);
    assert.equal(payment.method, "CASH");

    // Verify shift cash movement
    const cashMove = await server.queryOne("SELECT * FROM shift_cash_movements WHERE reference_id = ?", invoiceId);
    assert.ok(cashMove);
    assert.equal(cashMove.amount, 100000);
    assert.equal(cashMove.type, "PAYMENT");
  });

  test("Partial payment retains ISSUED status; full payment transitions to PAID", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_part', 'PS-PRT', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 200000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_part" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // 1. Partial payment 120,000 VND via BANK_TRANSFER (does not require cash shift)
    const partRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "BANK_TRANSFER", amount: 120000, reference: "BIDV-998877" },
    }, cashierCookie));
    assert.equal(partRes.status, 200);

    let invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.status, "ISSUED"); // Still ISSUED
    assert.equal(invoice.paid_at, null);

    const payments = await server.queryAll("SELECT * FROM payments WHERE invoice_id = ?", invoiceId);
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, 120000);

    // 2. Complete remaining payment 80,000 VND
    const finishRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "BANK_TRANSFER", amount: 80000, reference: "BIDV-998878" },
    }, cashierCookie));
    assert.equal(finishRes.status, 200);

    invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.status, "PAID");
    assert.ok(invoice.paid_at);

    const totalPaid = await server.queryOne("SELECT SUM(amount) AS total FROM payments WHERE invoice_id = ?", invoiceId);
    assert.equal(totalPaid.total, 200000);
  });
});

describe("BF-A13-03: Paid-Invoice Immutability and Reversal Policy", () => {
  test("Paid invoice cannot be modified, adjusted, paid again, split, or cancelled", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_immut', 'PS-IMM', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 100000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_immut" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // Pay invoice in full
    await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 100000 },
    }, cashierCookie));

    const invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.status, "PAID");

    // 1. Attempt to adjust paid invoice -> 400
    const adjRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.adjust",
      payload: { invoiceId, type: "DISCOUNT", amount: 10000, description: "Late discount" },
    }, cashierCookie));
    assert.equal(adjRes.status, 400);
    assert.match((await adjRes.json()).error, /Chỉ có thể điều chỉnh hóa đơn đang chờ thanh toán/);

    // 2. Attempt to pay paid invoice again -> 400
    const payAgainRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 10000 },
    }, cashierCookie));
    assert.equal(payAgainRes.status, 400);
    assert.match((await payAgainRes.json()).error, /Hóa đơn không ở trạng thái chờ thanh toán/);

    // 3. Attempt to cancel paid invoice -> 400
    const cancelRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.cancel",
      payload: { invoiceId, reason: "Khách đổi ý" },
    }, cashierCookie));
    assert.equal(cancelRes.status, 400);
    assert.match((await cancelRes.json()).error, /Chỉ có thể hủy hóa đơn chưa thanh toán/);

    // 4. Attempt to split paid invoice -> 400
    const splitRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.split",
      payload: { invoiceId, itemIds: ["some_id"] },
    }, cashierCookie));
    assert.equal(splitRes.status, 400);
    assert.match((await splitRes.json()).error, /Chỉ tách được hóa đơn chờ thanh toán/);
  });

  test("Cancellation of ISSUED invoice enforces reason and allows session to be re-invoiced", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_rev', 'PS-REV', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 60000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_rev" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // Missing cancellation reason -> 400
    const noReasonRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.cancel",
      payload: { invoiceId },
    }, cashierCookie));
    assert.equal(noReasonRes.status, 400);
    assert.match((await noReasonRes.json()).error, /Lý do hủy là bắt buộc/);

    // Cancel with reason succeeds
    const cancelRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.cancel",
      payload: { invoiceId, reason: "Nhập sai thông tin bàn" },
    }, cashierCookie));
    assert.equal(cancelRes.status, 200);

    const cancelledInvoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(cancelledInvoice.status, "CANCELLED");
    assert.equal(cancelledInvoice.cancel_reason, "Nhập sai thông tin bàn");
    assert.ok(cancelledInvoice.cancelled_at);

    // Audit trail
    const audit = await server.queryOne("SELECT * FROM audit_logs WHERE action = 'INVOICE_CANCELLED' AND entity_id = ?", invoiceId);
    assert.ok(audit);
    assert.match(audit.summary, /Hủy hóa đơn/);

    // Session can now be re-invoiced
    const reInvoiceRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_rev" },
    }, cashierCookie));
    assert.equal(reInvoiceRes.status, 200);
    const { data: { invoiceId: newId } } = await reInvoiceRes.json();
    assert.notEqual(newId, invoiceId);
  });
});

describe("BF-A13-04: Invoice Totals, Duplicate Payment & Failure Paths", () => {
  test("Overpayment and non-positive payment amounts are rejected", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_limits', 'PS-LIM', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 100000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_limits" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // 1. Negative amount -> 400
    const negRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: -50000 },
    }, cashierCookie));
    assert.equal(negRes.status, 400);
    assert.match((await negRes.json()).error, /Số tiền thanh toán không hợp lệ/);

    // 2. Overpayment -> amount exceeds 100,000 -> 400
    const overRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 150000 },
    }, cashierCookie));
    assert.equal(overRes.status, 400);
    assert.match((await overRes.json()).error, /Số tiền thanh toán không hợp lệ/);

    // 3. Partial payment of 60,000 succeeds
    const partRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 60000 },
    }, cashierCookie));
    assert.equal(partRes.status, 200);

    // 4. Overpayment on remaining balance: balance is 40,000, trying to pay 50,000 -> 400
    const overRemainingRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 50000 },
    }, cashierCookie));
    assert.equal(overRemainingRes.status, 400);
    assert.match((await overRemainingRes.json()).error, /Số tiền thanh toán không hợp lệ/);

    // 5. Pay remaining balance in full (40,000)
    const finishRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 40000 },
    }, cashierCookie));
    assert.equal(finishRes.status, 200);

    // 6. Attempting to pay an already PAID invoice -> 400
    const paidRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "CARD", amount: 10000 },
    }, cashierCookie));
    assert.equal(paidRes.status, 400);
    assert.match((await paidRes.json()).error, /Hóa đơn không ở trạng thái chờ thanh toán/);
  });

  test("Invoice split moves items to new invoice and recalculates both totals", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_split', 'PS-SPL', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 60000)"
    ).bind(now, now).run();

    await db.prepare("INSERT INTO orders (id, code, session_id, created_by, status) VALUES ('ord_spl', 'ORD-SPL', 'ses_split', 'usr_cashier', 'COMPLETED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_s1', 'ord_spl', 'p_mi', 'Mì xào', 1, 35000, 'SERVED')").run();
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_s2', 'ord_spl', 'p_coca', 'Coca', 2, 15000, 'SERVED')").run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_split" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();
    // Initial: table 60,000 + mì 35,000 + coca 30,000 = 125,000 VND

    const lines = await server.queryAll("SELECT id, description, amount FROM invoice_items WHERE invoice_id = ?", invoiceId);
    const cocaLine = lines.find((l) => l.description === "Coca");
    assert.ok(cocaLine);

    // Split coca line into new invoice
    const splitRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.split",
      payload: { invoiceId, itemIds: [cocaLine.id] },
    }, cashierCookie));
    assert.equal(splitRes.status, 200);
    const { data: { invoiceId: newInvoiceId } } = await splitRes.json();
    assert.ok(newInvoiceId);

    // Original invoice now has table 60,000 + mì 35,000 = 95,000 VND
    const origInvoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(origInvoice.total_amount, 95000);

    // New invoice has coca 30,000 VND
    const newInvoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", newInvoiceId);
    assert.equal(newInvoice.total_amount, 30000);
    assert.equal(newInvoice.status, "ISSUED");
  });

  test("Invoice merge consolidates items into target and cancels source invoices", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    // Two closed sessions
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_m1', 'PS-M1', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 50000)"
    ).bind(now, now).run();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_m2', 'PS-M2', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 70000)"
    ).bind(now, now).run();

    const inv1Res = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_m1" },
    }, cashierCookie));
    const { data: { invoiceId: inv1Id } } = await inv1Res.json();

    const inv2Res = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_m2" },
    }, cashierCookie));
    const { data: { invoiceId: inv2Id } } = await inv2Res.json();

    // Merge inv2 into inv1
    const mergeRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.merge",
      payload: { targetInvoiceId: inv1Id, sourceInvoiceIds: [inv2Id] },
    }, cashierCookie));
    assert.equal(mergeRes.status, 200);

    // Source invoice is cancelled
    const sourceInv = await server.queryOne("SELECT * FROM invoices WHERE id = ?", inv2Id);
    assert.equal(sourceInv.status, "CANCELLED");
    assert.equal(sourceInv.cancel_reason, "Đã gộp vào hóa đơn khác");

    // Target invoice has combined amount: 50,000 + 70,000 = 120,000 VND
    const targetInv = await server.queryOne("SELECT * FROM invoices WHERE id = ?", inv1Id);
    assert.equal(targetInv.total_amount, 120000);
    assert.equal(targetInv.table_amount, 120000);
  });
});

describe("BF-BILL-02: Validate Payment Method Enum and Payment Integrity", () => {
  test("Rejects payment when method is not in allowed enum (CASH, BANK_TRANSFER, CARD, EWALLET)", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_enum', 'PS-ENUM', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 80000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_enum" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // 1. Invalid method: BITCOIN -> 400
    const btcRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "BITCOIN", amount: 80000 },
    }, cashierCookie));
    assert.equal(btcRes.status, 400);
    const btcJson = await btcRes.json();
    assert.match(btcJson.error, /Phương thức thanh toán không hợp lệ/);

    // 2. Invalid method: VOUCHER -> 400
    const voucherRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "VOUCHER", amount: 80000 },
    }, cashierCookie));
    assert.equal(voucherRes.status, 400);
    const voucherJson = await voucherRes.json();
    assert.match(voucherJson.error, /Phương thức thanh toán không hợp lệ/);

    // 3. Invalid method: empty string -> 400
    const emptyRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: { invoiceId, method: "", amount: 80000 },
    }, cashierCookie));
    assert.equal(emptyRes.status, 400);

    // 4. Invoice remains in ISSUED status
    const inv = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(inv.status, "ISSUED");
    assert.equal(inv.paid_at, null);
  });

  test("Accepts EWALLET payment with reference and records payment accurately", async () => {
    const { actionRoute, cashierCookie, server } = fixture;
    const db = server.getRawDb();
    await seedBilliardEnvironment(db);

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at, ended_at, table_amount) VALUES ('ses_ewallet', 'PS-EWL', 'tbl_101', 'usr_cashier', 'CLOSED', ?, ?, 95000)"
    ).bind(now, now).run();

    const invRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.create",
      payload: { sessionId: "ses_ewallet" },
    }, cashierCookie));
    const { data: { invoiceId } } = await invRes.json();

    // Pay with EWALLET (Momo QR transaction)
    const payRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "invoice.pay",
      payload: {
        invoiceId,
        method: "EWALLET",
        amount: 95000,
        reference: "MOMO_TRX_987654321",
      },
    }, cashierCookie));
    assert.equal(payRes.status, 200);

    // Check payment record
    const payment = await server.queryOne("SELECT * FROM payments WHERE invoice_id = ?", invoiceId);
    assert.ok(payment);
    assert.equal(payment.method, "EWALLET");
    assert.equal(payment.amount, 95000);
    assert.equal(payment.reference, "MOMO_TRX_987654321");
    assert.equal(payment.received_by, "usr_cashier");

    // Check invoice transition to PAID
    const invoice = await server.queryOne("SELECT * FROM invoices WHERE id = ?", invoiceId);
    assert.equal(invoice.status, "PAID");
    assert.ok(invoice.paid_at);
  });
});
