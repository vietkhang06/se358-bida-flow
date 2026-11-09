import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestEnvironment, createJsonRequest } from "./helpers/test-fixture.mjs";

let fixture;

beforeEach(async () => {
  fixture = await setupTestEnvironment();
});

async function seedInventoryEnvironment(db) {
  await db.prepare("INSERT INTO product_categories (id, code, name) VALUES ('cat_drink', 'NUOC', 'Đồ uống')").run();
  await db.prepare("INSERT INTO product_categories (id, code, name) VALUES ('cat_snack', 'SNACK', 'Bánh snack')").run();
  await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_redbull', 'RB', 'Red Bull', 'cat_drink', 'PRODUCT', 'Lon', 25000, 15000, 20, 5, 1, 1)").run();
  await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_snack_lays', 'LAYS', 'Snack Lays', 'cat_snack', 'PRODUCT', 'Gói', 18000, 12000, 10, 3, 1, 1)").run();
  await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_cue_rent', 'CO_VIP', 'Thuê cơ VIP', NULL, 'SERVICE', 'Giờ', 30000, 0, 0, 0, 0, 1)").run();
}

describe("BF-A14-01: Inventory Stock Receipt, Adjustment and Audit Trail", () => {
  test("Stock receipt (IN) increases quantity, logs transaction with unit cost, and records audit trail", async () => {
    const { actionRoute, warehouseCookie, serviceCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    // 1. Role permission: SERVICE role lacks INVENTORY_MANAGE -> 403
    const forbiddenRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_redbull", type: "IN", quantity: 30, reason: "Nhập hàng từ nhà cung cấp" },
    }, serviceCookie));
    assert.equal(forbiddenRes.status, 403);

    // 2. Validation: Non-positive quantity for IN -> 400
    const zeroRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_redbull", type: "IN", quantity: 0, reason: "Nhập lỗi" },
    }, warehouseCookie));
    assert.equal(zeroRes.status, 400);
    assert.match((await zeroRes.json()).error, /Số lượng không hợp lệ/);

    // 3. Valid stock receipt: 30 units at cost 14,000 VND
    const inRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: {
        productId: "p_redbull",
        type: "IN",
        quantity: 30,
        unitCost: 14000,
        reason: "Nhập hàng nhà phân phối Đại Dương",
      },
    }, warehouseCookie));
    assert.equal(inRes.status, 200);

    // Verify product stock quantity: 20 + 30 = 50
    const product = await server.queryOne("SELECT * FROM products WHERE id = 'p_redbull'");
    assert.equal(product.stock_quantity, 50);

    // Verify inventory_transactions record
    const tx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_redbull' AND type = 'IN'");
    assert.ok(tx);
    assert.match(tx.code, /^NK-/);
    assert.equal(tx.quantity, 30);
    assert.equal(tx.before_quantity, 20);
    assert.equal(tx.after_quantity, 50);
    assert.equal(tx.unit_cost, 14000);
    assert.equal(tx.reason, "Nhập hàng nhà phân phối Đại Dương");
    assert.equal(tx.created_by, "usr_warehouse");

    // Verify audit log
    const audit = await server.queryOne("SELECT * FROM audit_logs WHERE action = 'INVENTORY_MOVED' AND entity_id = 'p_redbull'");
    assert.ok(audit);
    assert.match(audit.summary, /IN kho Red Bull/);
  });

  test("Stock issue (OUT) validates negative stock guard; fails when stock is insufficient", async () => {
    const { actionRoute, warehouseCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    // Current stock of Snack Lays is 10. Attempting to issue 15 -> 400
    const overRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_snack_lays", type: "OUT", quantity: 15, reason: "Xuất huỷ hết hạn" },
    }, warehouseCookie));
    assert.equal(overRes.status, 400);
    assert.match((await overRes.json()).error, /Không thể xuất kho làm tồn kho âm/);

    // Stock remains 10
    let product = await server.queryOne("SELECT * FROM products WHERE id = 'p_snack_lays'");
    assert.equal(product.stock_quantity, 10);

    // Valid stock issue: 4 units
    const validRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_snack_lays", type: "OUT", quantity: 4, reason: "Xuất huỷ hàng hỏng bao bì" },
    }, warehouseCookie));
    assert.equal(validRes.status, 200);

    product = await server.queryOne("SELECT * FROM products WHERE id = 'p_snack_lays'");
    assert.equal(product.stock_quantity, 6); // 10 - 4 = 6

    // Verify transaction
    const tx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_snack_lays' AND type = 'OUT'");
    assert.ok(tx);
    assert.match(tx.code, /^XK-/);
    assert.equal(tx.before_quantity, 10);
    assert.equal(tx.after_quantity, 6);
  });

  test("Stock manual adjustment (ADJUST) sets exact target quantity and records audit trail", async () => {
    const { actionRoute, warehouseCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    // Adjust Red Bull from 20 to 12
    const adjRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_redbull", type: "ADJUST", quantity: 12, reason: "Điều chỉnh sai số kiểm kê" },
    }, warehouseCookie));
    assert.equal(adjRes.status, 200);

    const product = await server.queryOne("SELECT * FROM products WHERE id = 'p_redbull'");
    assert.equal(product.stock_quantity, 12);

    const tx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_redbull' AND type = 'ADJUST'");
    assert.ok(tx);
    assert.match(tx.code, /^DC-/);
    assert.equal(tx.quantity, 8); // Math.abs(12 - 20) = 8
    assert.equal(tx.before_quantity, 20);
    assert.equal(tx.after_quantity, 12);

    // Negative quantity for ADJUST -> 400
    const negRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: { productId: "p_redbull", type: "ADJUST", quantity: -2, reason: "Số âm lỗi" },
    }, warehouseCookie));
    assert.equal(negRes.status, 400);
  });

  test("Physical stock count (stock.count) generates audit trail, updates discrepancy, and leaves match intact", async () => {
    const { actionRoute, warehouseCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    // System stock: Red Bull = 20, Snack Lays = 10
    // Physical count: Red Bull = 18 (difference -2), Snack Lays = 10 (difference 0)
    const countRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "stock.count",
      payload: {
        notes: "Kiểm kê định kỳ tháng 10",
        items: [
          { productId: "p_redbull", actualQuantity: 18, notes: "Thất thoát 2 lon" },
          { productId: "p_snack_lays", actualQuantity: 10, notes: "Khớp sổ sách" },
        ],
      },
    }, warehouseCookie));
    assert.equal(countRes.status, 200);

    // Verify stock counts record
    const stockCount = await server.queryOne("SELECT * FROM stock_counts WHERE status = 'COMPLETED'");
    assert.ok(stockCount);
    assert.match(stockCount.code, /^KK-/);
    assert.equal(stockCount.notes, "Kiểm kê định kỳ tháng 10");
    assert.equal(stockCount.counted_by, "usr_warehouse");

    // Verify count items
    const countItems = await server.queryAll("SELECT * FROM stock_count_items WHERE stock_count_id = ? ORDER BY actual_quantity", stockCount.id);
    assert.equal(countItems.length, 2);

    const rbItem = countItems.find((i) => i.product_id === "p_redbull");
    assert.equal(rbItem.system_quantity, 20);
    assert.equal(rbItem.actual_quantity, 18);
    assert.equal(rbItem.difference, -2);

    const laysItem = countItems.find((i) => i.product_id === "p_snack_lays");
    assert.equal(laysItem.system_quantity, 10);
    assert.equal(laysItem.actual_quantity, 10);
    assert.equal(laysItem.difference, 0);

    // Verify product stock updated for discrepancy
    const rbProduct = await server.queryOne("SELECT * FROM products WHERE id = 'p_redbull'");
    assert.equal(rbProduct.stock_quantity, 18);

    // Verify inventory_transactions created for discrepancy item
    const rbTx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_redbull' AND reference_type = 'STOCK_COUNT'");
    assert.ok(rbTx);
    assert.equal(rbTx.type, "ADJUST");
    assert.equal(rbTx.quantity, 2);
    assert.equal(rbTx.before_quantity, 20);
    assert.equal(rbTx.after_quantity, 18);
    assert.equal(rbTx.reference_id, stockCount.id);

    // Verify NO inventory transaction created for matching item
    const laysTx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_snack_lays' AND reference_type = 'STOCK_COUNT'");
    assert.equal(laysTx, null);

    // Audit log
    const audit = await server.queryOne("SELECT * FROM audit_logs WHERE action = 'STOCK_COUNT_COMPLETED' AND entity_id = ?", stockCount.id);
    assert.ok(audit);
    assert.match(audit.summary, /Hoàn tất kiểm kê kho/);
  });

  test("Order item status SERVED decrements tracked stock and prevents serving when stock is insufficient", async () => {
    const { actionRoute, serviceCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    await db.prepare("INSERT INTO areas (id, code, name) VALUES ('a_inv', 'KV_INV', 'Khu Bàn')").run();
    await db.prepare("INSERT INTO table_types (id, code, name, base_hourly_rate) VALUES ('tt_inv', 'POOL', 'Bàn Lỗ', 50000)").run();
    await db.prepare("INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status) VALUES ('tbl_inv', 'BI1', 'Bàn 1', 'a_inv', 'tt_inv', 'PLAYING')").run();

    const now = new Date().toISOString();
    await db.prepare("INSERT INTO play_sessions (id, code, table_id, opened_by, status, started_at) VALUES ('ses_inv', 'PS-INV', 'tbl_inv', 'usr_service', 'ACTIVE', ?)").bind(now).run();
    await db.prepare("INSERT INTO orders (id, code, session_id, created_by, status) VALUES ('ord_inv', 'ORD-INV', 'ses_inv', 'usr_service', 'OPEN')").run();

    // Item 1: 5 Red Bulls (stock = 20) -> should succeed and leave 15
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_rb', 'ord_inv', 'p_redbull', 'Red Bull', 5, 25000, 'PENDING')").run();

    // Item 2: 25 Snack Lays (stock = 10) -> should fail when trying to serve
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_lays', 'ord_inv', 'p_snack_lays', 'Snack Lays', 25, 18000, 'PENDING')").run();

    // Item 3: Service item (track_stock = 0) -> should serve without stock check
    await db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status) VALUES ('oi_cue', 'ord_inv', 'p_cue_rent', 'Thuê cơ VIP', 2, 30000, 'PENDING')").run();

    // 1. Serving Snack Lays fails due to insufficient stock -> 400
    const failRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "order.item.status",
      payload: { itemId: "oi_lays", status: "SERVED" },
    }, serviceCookie));
    assert.equal(failRes.status, 400);
    assert.match((await failRes.json()).error, /Tồn kho không đủ để hoàn tất món/);

    // 2. Serving Red Bull succeeds
    const okRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "order.item.status",
      payload: { itemId: "oi_rb", status: "SERVED" },
    }, serviceCookie));
    assert.equal(okRes.status, 200);

    const rbProduct = await server.queryOne("SELECT * FROM products WHERE id = 'p_redbull'");
    assert.equal(rbProduct.stock_quantity, 15); // 20 - 5 = 15

    const saleTx = await server.queryOne("SELECT * FROM inventory_transactions WHERE product_id = 'p_redbull' AND reference_type = 'ORDER_ITEM'");
    assert.ok(saleTx);
    assert.equal(saleTx.type, "SALE");
    assert.equal(saleTx.quantity, 5);
    assert.equal(saleTx.before_quantity, 20);
    assert.equal(saleTx.after_quantity, 15);
    assert.equal(saleTx.reference_id, "oi_rb");

    // 3. Serving untracked service succeeds with no stock change
    const cueRes = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "order.item.status",
      payload: { itemId: "oi_cue", status: "SERVED" },
    }, serviceCookie));
    assert.equal(cueRes.status, 200);

    const cueProduct = await server.queryOne("SELECT * FROM products WHERE id = 'p_cue_rent'");
    assert.equal(cueProduct.stock_quantity, 0);
  });
});

describe("BF-INV-02: Low-Stock Alerts and Replenishment Workflow", () => {
  test("Accurately identifies products at or below min_stock threshold in summary and triggers replenishment", async () => {
    const { actionRoute, appRoute, warehouseCookie, adminCookie, server } = fixture;
    const db = server.getRawDb();
    await seedInventoryEnvironment(db);

    // Seed additional items with defined thresholds:
    // Product 1: Below threshold (stock 2 <= min_stock 5) -> Low stock
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_low_1', 'LOW1', 'Trà chanh C2', 'cat_drink', 'PRODUCT', 'Chai', 12000, 7000, 2, 5, 1, 1)").run();

    // Product 2: Exactly at threshold (stock 5 <= min_stock 5) -> Low stock
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_low_2', 'LOW2', 'Khăn lạnh', 'cat_drink', 'PRODUCT', 'Cái', 5000, 2000, 5, 5, 1, 1)").run();

    // Product 3: Above threshold (stock 15 > min_stock 5) -> Normal
    await db.prepare("INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active) VALUES ('p_norm', 'NORM', 'Bia Heineken', 'cat_drink', 'PRODUCT', 'Lon', 30000, 20000, 15, 5, 1, 1)").run();

    // Query app summary: Red Bull (20 > 5), Lays (10 > 3), p_cue_rent (untracked 0), p_low_1 (2 <= 5), p_low_2 (5 <= 5)
    // Low stock count should be exactly 2
    let appRes = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, adminCookie));
    assert.equal(appRes.status, 200);
    let appData = await appRes.json();
    assert.equal(appData.summary.low_stock_count, 2);

    // Replenishment step 1: Replenish p_low_1 with 10 units via inventory.move (IN)
    const replenish1 = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: {
        productId: "p_low_1",
        type: "IN",
        quantity: 10,
        unitCost: 7000,
        reason: "Nhập bổ sung hàng sắp hết",
      },
    }, warehouseCookie));
    assert.equal(replenish1.status, 200);

    // Check p_low_1 stock is now 2 + 10 = 12 (> min_stock 5)
    const p1 = await server.queryOne("SELECT stock_quantity FROM products WHERE id = 'p_low_1'");
    assert.equal(p1.stock_quantity, 12);

    // Low stock count drops from 2 to 1 (only p_low_2 remains low-stock)
    appRes = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, adminCookie));
    appData = await appRes.json();
    assert.equal(appData.summary.low_stock_count, 1);

    // Replenishment step 2: Replenish p_low_2 with 20 units via inventory.move (IN)
    const replenish2 = await actionRoute.POST(createJsonRequest("http://localhost:3000/api/action", "POST", {
      action: "inventory.move",
      payload: {
        productId: "p_low_2",
        type: "IN",
        quantity: 20,
        unitCost: 2000,
        reason: "Nhập thêm khăn lạnh đầy kho",
      },
    }, warehouseCookie));
    assert.equal(replenish2.status, 200);

    // Check p_low_2 stock is now 5 + 20 = 25 (> min_stock 5)
    const p2 = await server.queryOne("SELECT stock_quantity FROM products WHERE id = 'p_low_2'");
    assert.equal(p2.stock_quantity, 25);

    // Low stock count drops to 0
    appRes = await appRoute.GET(createJsonRequest("http://localhost:3000/api/app", "GET", null, adminCookie));
    appData = await appRes.json();
    assert.equal(appData.summary.low_stock_count, 0);

    // Verify audit logs generated for replenishments
    const auditLogs = await server.queryAll("SELECT * FROM audit_logs WHERE action = 'INVENTORY_MOVED' AND entity_id IN ('p_low_1', 'p_low_2')");
    assert.equal(auditLogs.length, 2);
  });
});
