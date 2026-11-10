import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";

function enableAsyncD1Latency(db, delayMs = 2) {
  const origPrepare = db.prepare.bind(db);
  const origBatch = db.batch.bind(db);
  const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * delayMs));

  db.prepare = (query) => {
    const stmt = origPrepare(query);
    const wrap = (st) => ({
      ...st,
      bind: (...params) => wrap(st.bind(...params)),
      first: async () => {
        await pause();
        return st.first();
      },
      all: async () => {
        await pause();
        return st.all();
      },
      run: async () => {
        await pause();
        return st.run();
      },
    });
    return wrap(stmt);
  };

  db.batch = async (statements) => {
    await pause();
    return origBatch(statements);
  };
}

describe("BF-PERF-01: Concurrency & Data Invariant Verification (with async D1 interleaving)", () => {
  let f;

  beforeEach(async () => {
    f = await operationsFixture();
    enableAsyncD1Latency(f.db, 3);
  });

  afterEach(() => {
    f.db._raw.close();
  });

  test("concurrent invoice.create on same closed session produces exactly one invoice", async () => {
    const sessionId = await f.start("b1");
    await f.call("session.end", { sessionId });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => f.call("invoice.create", { sessionId }, "cashier", null)),
    );
    const okCount = results.filter((r) => r.status === 200).length;
    assert.equal(okCount, 1, `Expected 1 invoice.create success, got ${okCount}: ${JSON.stringify(results)}`);
    assert.equal(
      (await f.one("SELECT COUNT(*) n FROM invoices WHERE session_id=? AND status<>'CANCELLED'", sessionId)).n,
      1,
    );
  });

  test("concurrent full invoice.pay requests cannot double-pay, double-record cash, or double-award points", async () => {
    await f.db.prepare("INSERT INTO customers (id, code, full_name) VALUES ('c1', 'KH1', 'Khách VIP')").run();
    await f.db.prepare("INSERT INTO membership_tiers (id, code, name, discount_percent) VALUES ('tier1', 'GOLD', 'Vàng', 0)").run();
    await f.db.prepare("INSERT INTO memberships (id, customer_id, tier_id, points) VALUES ('mem1', 'c1', 'tier1', 0)").run();

    const { sessionId } = (await f.call("session.start", { tableId: "b1", customerId: "c1" })).data;
    await f.call("session.end", { sessionId });
    await f.db.prepare("UPDATE play_sessions SET table_amount=100000 WHERE id=?").bind(sessionId).run();
    const { invoiceId } = (await f.call("invoice.create", { sessionId })).data;

    await f.call("shift.open", { openingCash: 500000 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        f.call("invoice.pay", { invoiceId, method: "CASH", amount: 100000 }, "cashier", null),
      ),
    );
    const okCount = results.filter((r) => r.status === 200).length;
    assert.equal(okCount, 1, `Expected 1 payment success, got ${okCount}: ${JSON.stringify(results)}`);
    assert.equal((await f.one("SELECT status FROM invoices WHERE id=?", invoiceId)).status, "PAID");
    assert.equal((await f.one("SELECT COUNT(*) n FROM payments WHERE invoice_id=?", invoiceId)).n, 1);
    assert.equal((await f.one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?", invoiceId)).s, 100000);
    assert.equal(
      (await f.one("SELECT COUNT(*) n FROM shift_cash_movements WHERE reference_id=? AND type='PAYMENT'", invoiceId)).n,
      1,
    );
    assert.equal(
      (await f.one("SELECT COUNT(*) n FROM loyalty_transactions WHERE reference_id=?", invoiceId)).n,
      1,
    );
    assert.equal((await f.one("SELECT points FROM memberships WHERE id='mem1'")).points, 10);
  });

  test("concurrent partial invoice.pay exceeding remaining balance cannot overpay", async () => {
    const sessionId = await f.start("b1");
    await f.call("session.end", { sessionId });
    await f.db.prepare("UPDATE play_sessions SET table_amount=100000 WHERE id=?").bind(sessionId).run();
    const { invoiceId } = (await f.call("invoice.create", { sessionId })).data;

    const results = await Promise.all([
      f.call("invoice.pay", { invoiceId, method: "BANK_TRANSFER", amount: 60000 }, "cashier", null),
      f.call("invoice.pay", { invoiceId, method: "BANK_TRANSFER", amount: 60000 }, "cashier", null),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    const paid = (await f.one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?", invoiceId)).s;
    assert.equal(paid, 60000);
    assert.equal((await f.one("SELECT status FROM invoices WHERE id=?", invoiceId)).status, "ISSUED");
  });

  test("concurrent invoice.adjust calls do not lose discount updates, and cancel vs pay remains mutually exclusive", async () => {
    const sessionId = await f.start("b1");
    await f.call("session.end", { sessionId });
    await f.db.prepare("UPDATE play_sessions SET table_amount=100000 WHERE id=?").bind(sessionId).run();
    const { invoiceId } = (await f.call("invoice.create", { sessionId })).data;

    const adjResults = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        f.call("invoice.adjust", { invoiceId, type: "DISCOUNT", amount: 5000, description: `Giảm ${i}` }, "cashier", null),
      ),
    );
    assert.equal(adjResults.filter((r) => r.status === 200).length, 4);
    const afterAdj = await f.one("SELECT discount_amount, total_amount FROM invoices WHERE id=?", invoiceId);
    assert.equal(afterAdj.discount_amount, 20000);
    assert.equal(afterAdj.total_amount, 80000);

    const race = await Promise.all([
      f.call("invoice.pay", { invoiceId, method: "CARD", amount: 80000 }, "cashier", null),
      f.call("invoice.cancel", { invoiceId, reason: "Tranh chấp hủy/thanh toán" }, "cashier", null),
    ]);
    assert.equal(race.filter((r) => r.status === 200).length, 1);
    const finalInv = await f.one("SELECT status FROM invoices WHERE id=?", invoiceId);
    assert.ok(["PAID", "CANCELLED"].includes(finalInv.status));
    if (finalInv.status === "CANCELLED") {
      assert.equal((await f.one("SELECT COUNT(*) n FROM payments WHERE invoice_id=?", invoiceId)).n, 0);
    } else {
      assert.equal((await f.one("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=?", invoiceId)).s, 80000);
    }
  });

  test("concurrent inventory.move IN preserves all increments without lost updates", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        f.call("inventory.move", { productId: "p", type: "IN", quantity: 5, reason: `Batch ${i}` }, "warehouse", null),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 4);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 30);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions WHERE product_id='p' AND type='IN'")).n, 4);
  });

  test("concurrent inventory.move OUT prevents negative stock and overselling", async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        f.call("inventory.move", { productId: "p", type: "OUT", quantity: 7, reason: `Out ${i}` }, "warehouse", null),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 3);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions WHERE product_id='p' AND type='OUT'")).n, 1);
  });

  test("concurrent shift.open and shift.close execute once without duplicate shifts or closing rows", async () => {
    const opens = await Promise.all(
      Array.from({ length: 4 }, () => f.call("shift.open", { openingCash: 200000 }, "cashier", null)),
    );
    assert.equal(opens.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM work_shifts WHERE status='OPEN'")).n, 1);

    const closes = await Promise.all(
      Array.from({ length: 4 }, () => f.call("shift.close", { actualCash: 200000 }, "cashier", null)),
    );
    assert.equal(closes.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM work_shifts WHERE status='CLOSED'")).n, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM shift_cash_movements WHERE type='CLOSING'")).n, 1);
  });

  test("concurrent session.start, reservation.save, and order.item.status SERVED uphold invariants", async () => {
    const starts = await Promise.all(
      Array.from({ length: 6 }, () => f.call("session.start", { tableId: "b1" }, "cashier", null)),
    );
    assert.equal(starts.filter((r) => r.status === 200).length, 1);
    const sessionId = starts.find((r) => r.status === 200).data.sessionId;
    assert.equal((await f.one("SELECT COUNT(*) n FROM play_sessions WHERE table_id='b1' AND status='ACTIVE'")).n, 1);

    const bookingPayload = f.booking({ tableId: "b2" });
    const bookings = await Promise.all(
      Array.from({ length: 5 }, () => f.call("reservation.save", bookingPayload, "cashier", null)),
    );
    assert.equal(bookings.filter((r) => r.status === 200).length, 1);
    assert.equal((await f.one("SELECT COUNT(*) n FROM reservations WHERE table_id='b2'")).n, 1);

    const { itemId } = (await f.call("order.add", { sessionId, productId: "p", quantity: 4 }, "service")).data;
    const serves = await Promise.all(
      Array.from({ length: 4 }, () => f.call("order.item.status", { itemId, status: "SERVED" }, "service", null)),
    );
    assert.ok(serves.every((r) => [200, 409].includes(r.status)));
    assert.equal(serves.filter((r) => r.status === 200 && !r.data?.unchanged).length, 1);
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 6);
    assert.equal((await f.one("SELECT COUNT(*) n FROM inventory_transactions WHERE reference_id=?", itemId)).n, 1);
  });
});
