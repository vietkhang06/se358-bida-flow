import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
import { createJsonRequest } from "./helpers/test-fixture.mjs";
let f;
beforeEach(async () => { f = await operationsFixture(); });
afterEach(() => f.db._raw.close());
describe("BF-PLAT-04: stable error codes and runtime payload checks", () => {
  test("reject unsupported method before writing payments", async () => {
    const result = await f.call("invoice.pay", { invoiceId: "missing", method: "FAKE_METHOD", amount: 1000 }, "manager", 400);
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.equal((await f.one("SELECT COUNT(*) n FROM payments")).n, 0);
  });
  test("numeric values must be finite", async () => {
    for (const discountPercent of ["NaN", "Infinity", {}, true]) {
      const r = await f.call("tier.save", { code: "SILVER", name: "Bạc", discountPercent }, "manager", 400);
      assert.equal(r.code, "VALIDATION_ERROR");
    }
    assert.equal((await f.one("SELECT COUNT(*) n FROM membership_tiers WHERE code='SILVER'")).n, 0);
  });
  test("invalid action envelopes have machine-readable errors", async () => {
    for (const raw of [null, { action: " " }, { action: "profile.update", payload: [] }, { action: 5 }]) {
      const r = await f.actionRoute.POST(createJsonRequest("http://localhost/api/action", "POST", raw, f.managerCookie));
      assert.equal(r.status, 400); const j = await r.json(); assert.equal(j.code, "VALIDATION_ERROR"); assert.equal(typeof j.error, "string");
    }
  });
  test("duplicate stock items cannot change stock", async () => {
    const res = await f.call("stock.count", { items: [{ productId: "p", actualQuantity: 3 }, { productId: "p", actualQuantity: 2 }] }, "manager", 400);
    assert.equal(res.code, "VALIDATION_ERROR");
    assert.equal((await f.one("SELECT stock_quantity FROM products WHERE id='p'")).stock_quantity, 10);
  });
  test("401 remains stable for unauthenticated actions", async () => {
    const r = await f.actionRoute.POST(createJsonRequest("http://localhost/api/action", "POST", { action: "profile.update", payload: { fullName: "T" } }));
    assert.equal(r.status, 401); assert.equal((await r.json()).code, "UNAUTHENTICATED");
  });
  test("valid action remains backward compatible", async () => {
    const r = await f.call("profile.update", { fullName: "Tên mới" }, "service");
    assert.equal(r.ok, true);
    assert.equal((await f.one("SELECT full_name FROM users WHERE id='usr_service'")).full_name, "Tên mới");
  });
});
