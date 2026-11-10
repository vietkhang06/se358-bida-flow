// End-to-end verification suite against a real Cloudflare Worker + D1 instance
// (supports isolated local Wrangler D1 via scripts/with-local-wrangler.mjs or dedicated staging via BIDAFLOW_E2E_URL).
import assert from "node:assert/strict";

const base = process.env.BIDAFLOW_E2E_URL ?? "http://127.0.0.1:8788";
const baseOrigin = new URL(base).origin;
const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname);
if (!isLoopback && (process.env.BIDAFLOW_E2E_ALLOW_REMOTE !== "1" || process.env.BIDAFLOW_E2E_ENV !== "staging")) {
  throw new Error(
    `Refusing remote E2E against ${base}. Set BIDAFLOW_E2E_ALLOW_REMOTE=1 and BIDAFLOW_E2E_ENV=staging for a dedicated test/staging D1 environment.`,
  );
}

const runId = Date.now().toString(36).toUpperCase();
const tag = `QA-E2E-${runId}`;
const password = "BidaFlowE2E!2026";
const setupCode = process.env.BIDAFLOW_TEST_SETUP_CODE ?? "bidaflow-local-qa-setup-code";
const results = [];

async function api(path, { method = "GET", body, cookie, origin = baseOrigin, expectedStatus } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).catch((error) => { throw new Error(`${method} ${path}: ${error.message}`, { cause: error }); });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (expectedStatus !== undefined) {
    assert.equal(res.status, expectedStatus, `${method} ${path} expected ${expectedStatus}, got ${res.status}: ${text}`);
  }
  const setCookie = res.headers.get("set-cookie");
  const nextCookie = setCookie ? setCookie.split(";")[0] : cookie;
  return { status: res.status, headers: res.headers, json, cookie: nextCookie };
}

function record(id, description, detail = {}) {
  results.push({ id, description, status: "PASS", ...detail });
}

async function main() {
  // 1. Unauthenticated and cross-origin guards
  await api("/api/app", { expectedStatus: 401 });
  await api("/api/action", { method: "POST", body: { action: "area.save", payload: {} }, expectedStatus: 401 });
  record("E2E-01", "Unauthenticated requests return 401");

  // 2. Bootstrap / Admin authentication + negative auth checks
  const authStatus = await api("/api/auth/status", { expectedStatus: 200 });
  const adminEmail = `qa-admin-${runId.toLowerCase()}@bidaflow.test`;
  let adminCookie;

  if (!authStatus.json.initialized) {
    await api("/api/auth/register", {
      method: "POST",
      body: { fullName: `Admin ${tag}`, email: adminEmail, password, setupCode: "WRONG_SETUP" },
      expectedStatus: 403,
    });
    const reg = await api("/api/auth/register", {
      method: "POST",
      body: { fullName: `Admin ${tag}`, email: adminEmail, password, setupCode },
      expectedStatus: 201,
    });
    adminCookie = reg.cookie;
  } else {
    const loginEmail = process.env.BIDAFLOW_E2E_ADMIN_EMAIL;
    const loginPassword = process.env.BIDAFLOW_E2E_ADMIN_PASSWORD;
    assert.ok(loginEmail && loginPassword, "Already initialized target requires BIDAFLOW_E2E_ADMIN_EMAIL and BIDAFLOW_E2E_ADMIN_PASSWORD");
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { identity: loginEmail, password: loginPassword },
      expectedStatus: 200,
    });
    adminCookie = login.cookie;
  }
  assert.ok(adminCookie, "Admin cookie must be present");

  await api("/api/auth/login", {
    method: "POST",
    body: { identity: adminEmail, password: "WrongPassword1!" },
    expectedStatus: 401,
  });
  await api("/api/action", {
    method: "POST",
    body: { action: "area.save", payload: { code: "BAD", name: "Bad" } },
    cookie: adminCookie,
    origin: "https://evil.example.invalid",
    expectedStatus: 403,
  });
  record("E2E-02", "Admin auth, wrong password 401, and cross-origin 403 verified");

  const act = (action, payload, cookie = adminCookie, expectedStatus = 200) =>
    api("/api/action", { method: "POST", body: { action, payload }, cookie, expectedStatus });

  // 3. Invite and register CASHIER, SERVICE, WAREHOUSE staff + RBAC checks
  const adminApp = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  const rolesByCode = new Map(adminApp.json.roles.map((r) => [r.code, r.id]));

  const staffCookies = {};
  const staffUserIds = [];
  for (const roleCode of ["CASHIER", "SERVICE", "WAREHOUSE"]) {
    const staffEmail = `qa-${roleCode.toLowerCase()}-${runId.toLowerCase()}@bidaflow.test`;
    const inviteRes = await act("user.invite", { roleId: rolesByCode.get(roleCode), email: staffEmail });
    const inviteCode = inviteRes.json.data.invitationCode;

    // Wrong email for restricted invite -> 403
    await api("/api/auth/register", {
      method: "POST",
      body: { fullName: "Wrong Email", email: `other-${runId.toLowerCase()}@bidaflow.test`, password, invitationCode: inviteCode },
      expectedStatus: 403,
    });

    const regStaff = await api("/api/auth/register", {
      method: "POST",
      body: { fullName: `${roleCode} ${tag}`, email: staffEmail, password, invitationCode: inviteCode },
      expectedStatus: 201,
    });
    staffCookies[roleCode] = regStaff.cookie;

    // Replay single-use invitation -> 403
    await api("/api/auth/register", {
      method: "POST",
      body: { fullName: "Replay", email: staffEmail, password, invitationCode: inviteCode },
      expectedStatus: 403,
    });
  }
  const refreshedAdmin = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  for (const u of refreshedAdmin.json.users) {
    if (String(u.email).includes(runId.toLowerCase()) && u.role_code !== "ADMIN") {
      staffUserIds.push({ id: u.id, roleId: u.role_id, fullName: u.full_name });
    }
  }

  // Negative RBAC assertions
  await act("area.save", { code: `NO-${runId}`, name: `No ${tag}` }, staffCookies.SERVICE, 403);
  await act("session.start", { tableId: "missing" }, staffCookies.WAREHOUSE, 403);
  const cashierApp = await api("/api/app", { cookie: staffCookies.CASHIER, expectedStatus: 200 });
  assert.equal(cashierApp.json.report, null, "Cashier must not see reports");
  assert.equal(cashierApp.json.summary.today_revenue, undefined, "Cashier must not see today_revenue");
  const whApp = await api("/api/app", { cookie: staffCookies.WAREHOUSE, expectedStatus: 200 });
  assert.equal(whApp.json.tables.length, 0, "Warehouse must not receive table board");
  record("E2E-03", "Staff invitation, single-use guard, and 403/filtered RBAC verified");

  // 4. Catalog, pricing, customer, membership, and inventory setup
  const areaId = (await act("area.save", { code: `AR-${runId}`, name: `Khu ${tag}` })).json.data.id;
  const tableTypeId = (await act("tableType.save", { code: `TT-${runId}`, name: `Pool ${tag}`, baseHourlyRate: 60000 })).json.data.id;
  const priceRuleId = (await act("price.save", { tableTypeId, name: `Giá ${tag}`, hourlyRate: 72000, priority: 1 })).json.data.id;
  const table1Id = (await act("table.save", { code: `T1-${runId}`, name: `Bàn 1 ${tag}`, areaId, tableTypeId })).json.data.id;
  const table2Id = (await act("table.save", { code: `T2-${runId}`, name: `Bàn 2 ${tag}`, areaId, tableTypeId })).json.data.id;
  await act("table.save", { code: `T1-${runId}`, name: `Trùng ${tag}`, areaId, tableTypeId }, adminCookie, 409);

  const catId = (await act("category.save", { code: `CAT-${runId}`, name: `Nhóm ${tag}` })).json.data.id;
  const productId = (await act("product.save", { code: `PRD-${runId}`, name: `Nước ${tag}`, categoryId: catId, salePrice: 20000 })).json.data.id;
  await act("inventory.move", { productId, type: "IN", quantity: 20, unitCost: 12000, reason: `Nhập ${tag}` }, staffCookies.WAREHOUSE);
  await act("inventory.move", { productId, type: "OUT", quantity: 99, reason: "Âm kho" }, staffCookies.WAREHOUSE, 400);

  await act("customer.save", { fullName: `Khách ${tag}`, phone: `09${runId.replace(/\D/g, "").padEnd(8, "7").slice(0, 8)}` }, staffCookies.CASHIER);
  await act("tier.save", { code: `VIP-${runId}`, name: `VIP ${tag}`, discountPercent: 10 });
  const afterSetupApp = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  const customerId = afterSetupApp.json.customers.find((c) => c.full_name === `Khách ${tag}`).id;
  const tierId = afterSetupApp.json.tiers.find((t) => t.code === `VIP-${runId}`).id;
  await act("membership.save", { customerId, tierId });
  record("E2E-04", "Catalog, pricing, duplicate checks, inventory guard, and membership persisted in D1");

  // 5. Reservation -> Seat -> Pause -> Resume -> Transfer -> Order -> End -> Invoice -> Payment -> Shift
  const startsAt = new Date(Date.now() + 60_000).toISOString();
  const endsAt = new Date(Date.now() + 3_600_000).toISOString();
  const reservationId = (
    await act("reservation.save", { tableId: table1Id, customerId, customerName: `Khách ${tag}`, customerPhone: "0900000001", startsAt, endsAt }, staffCookies.CASHIER)
  ).json.data.reservationId;
  // Overlapping reservation rejected
  await act("reservation.save", { tableId: table1Id, customerName: "Overlap", customerPhone: "0900000002", startsAt, endsAt }, staffCookies.CASHIER, 409);
  await act("reservation.status", { id: reservationId, status: "CONFIRMED" }, staffCookies.CASHIER);

  const sessionId = (await act("reservation.seat", { reservationId }, staffCookies.SERVICE)).json.data.sessionId;
  const midSessionApp = await api("/api/app", { cookie: staffCookies.CASHIER, expectedStatus: 200 });
  assert.equal(midSessionApp.json.tables.find((t) => t.id === table1Id).status, "PLAYING");

  await act("session.pause", { sessionId, reason: `Nghỉ ${tag}` }, staffCookies.CASHIER);
  await act("session.resume", { sessionId }, staffCookies.CASHIER);
  await act("session.transfer", { sessionId, toTableId: table2Id, reason: `Đổi bàn ${tag}` }, staffCookies.CASHIER);

  const afterTransferApp = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  assert.equal(afterTransferApp.json.tables.find((t) => t.id === table1Id).status, "AVAILABLE");
  assert.equal(afterTransferApp.json.tables.find((t) => t.id === table2Id).status, "PLAYING");

  const { itemId } = (await act("order.add", { sessionId, productId, quantity: 2 }, staffCookies.SERVICE)).json.data;
  await act("order.item.update", { itemId, quantity: 3, notes: `Ít đá ${tag}` }, staffCookies.SERVICE);
  await act("session.end", { sessionId }, staffCookies.SERVICE, 409);
  await act("session.end", { sessionId, confirmPendingOrders: true }, staffCookies.SERVICE);
  await act("invoice.create", { sessionId }, staffCookies.CASHIER, 400);

  // Serve twice idempotently -> deduct stock once (20 - 3 = 17)
  await act("order.item.status", { itemId, status: "SERVED" }, staffCookies.SERVICE);
  await act("order.item.status", { itemId, status: "SERVED" }, staffCookies.SERVICE);
  const afterServeApp = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  assert.equal(afterServeApp.json.products.find((p) => p.id === productId).stock_quantity, 17);

  await act("shift.open", { openingCash: 300000 }, staffCookies.CASHIER);
  const { invoiceId, total } = (await act("invoice.create", { sessionId }, staffCookies.CASHIER)).json.data;
  assert.ok(total > 0, "Invoice total must be positive");
  const { total: adjustedTotal } = (await act("invoice.adjust", { invoiceId, type: "SURCHARGE", amount: 5000, description: `Phụ thu ${tag}` }, staffCookies.CASHIER)).json.data;
  assert.equal(adjustedTotal, total + 5000);

  const partAmount = Math.floor(adjustedTotal / 2);
  await act("invoice.pay", { invoiceId, method: "BANK_TRANSFER", amount: partAmount, reference: tag }, staffCookies.CASHIER);
  await act("invoice.pay", { invoiceId, method: "CASH", amount: adjustedTotal - partAmount }, staffCookies.CASHIER);

  // Paid invoice immutability
  await act("invoice.adjust", { invoiceId, type: "DISCOUNT", amount: 1000, description: "Invalid" }, staffCookies.CASHIER, 400);
  await act("invoice.cancel", { invoiceId, reason: "Invalid" }, staffCookies.CASHIER, 400);
  await act("invoice.pay", { invoiceId, method: "CASH", amount: 1000 }, staffCookies.CASHIER, 400);
  await act("shift.close", { actualCash: 300000 + (adjustedTotal - partAmount) }, staffCookies.CASHIER);
  record("E2E-05", "Reservation, session transfer/pause/end, atomic stock serve, invoice pay/immutability, and shift close verified");

  // 6. Verify Admin snapshot, audit logs, reports (including #47 filters if present)
  const finalRead = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  const paidInv = finalRead.json.invoices.find((i) => i.id === invoiceId);
  assert.equal(paidInv.status, "PAID");
  assert.equal(paidInv.paid_amount, adjustedTotal);
  assert.ok(finalRead.json.auditLogs.some((l) => l.entity_id === invoiceId && l.action === "INVOICE_PAID"));

  if (finalRead.json.reportMeta) {
    const today = finalRead.json.reportMeta.to;
    const filtered = await api(`/api/app?reportFrom=${today}&reportTo=${today}&reportTz=Asia/Ho_Chi_Minh`, {
      cookie: adminCookie,
      expectedStatus: 200,
    });
    assert.ok(filtered.json.report.revenue.some((r) => r.day === today && r.revenue >= adjustedTotal));
    await api("/api/app?reportFrom=2026-11-11&reportTo=2026-11-10&reportTz=Asia/Ho_Chi_Minh", {
      cookie: adminCookie,
      expectedStatus: 400,
    });
    record("E2E-06", "Timezone-aware report filter query & invalid range 400 verified on D1");
  } else {
    record("E2E-06", "Base report snapshot verified (timezone filter extension pending #47 merge)");
  }

  // 7. Cleanup test catalog, tables, prices, and lock temporary E2E staff
  await act("product.delete", { id: productId });
  await act("category.delete", { id: catId });
  await act("price.delete", { id: priceRuleId });
  await act("table.delete", { id: table1Id });
  await act("table.delete", { id: table2Id });
  await act("tableType.delete", { id: tableTypeId });
  await act("area.delete", { id: areaId });
  for (const s of staffUserIds) {
    await act("user.update", { id: s.id, roleId: s.roleId, fullName: s.fullName, status: "LOCKED" });
  }
  const afterCleanup = await api("/api/app", { cookie: adminCookie, expectedStatus: 200 });
  assert.equal(afterCleanup.json.tables.some((t) => t.id === table1Id || t.id === table2Id), false);
  assert.equal(afterCleanup.json.products.some((p) => p.id === productId), false);
  record("E2E-07", "Isolated test fixtures deactivated/locked and verified absent from active catalog");

  // 8. Logout invalidates cookie
  const logoutRes = await api("/api/auth/logout", { method: "POST", body: {}, cookie: adminCookie, expectedStatus: 200 });
  assert.match(logoutRes.headers.get("set-cookie") ?? "", /Max-Age=0/);
  await api("/api/app", { cookie: adminCookie, expectedStatus: 401 });
  record("E2E-08", "Logout clears session in D1 and subsequent /api/app returns 401");

  console.log(JSON.stringify({
    target: base,
    environmentType: isLoopback ? "local-wrangler-d1" : process.env.BIDAFLOW_E2E_ENV,
    runTag: tag,
    totalSteps: results.length,
    passedSteps: results.filter((r) => r.status === "PASS").length,
    steps: results,
  }, null, 2));
}

main().catch((err) => {
  console.error("E2E D1 failed:", err);
  process.exit(1);
});
