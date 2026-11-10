// Performance & concurrency validation harness for BF-PERF-01 (#54).
// Runs against an explicit local test server (Wrangler + local D1) and checks DB invariants afterward.
import assert from "node:assert/strict";

const base = process.env.BIDAFLOW_PERF_URL ?? "http://127.0.0.1:8788";
const parsedBase = new URL(base);
const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsedBase.hostname);
if (!isLoopback && process.env.BIDAFLOW_PERF_ALLOW_REMOTE !== "1") {
  throw new Error(`Refusing to run load test against non-local host: ${parsedBase.hostname}`);
}

const setupCode = process.env.BIDAFLOW_TEST_SETUP_CODE || "perf-local-setup-code";
const stamp = Date.now().toString(36).toUpperCase();
const adminEmail = `perf-admin-${stamp.toLowerCase()}@bidaflow.test`;
const password = "BidaFlowPerf123!";

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

function summarizeLatencies(samplesMs, totalWallMs, unexpectedErrors, totalRequests) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    requests: totalRequests,
    wallMs: Number(totalWallMs.toFixed(2)),
    throughputRps: Number(((totalRequests / Math.max(1, totalWallMs)) * 1000).toFixed(2)),
    unexpectedErrors,
    errorRatePct: Number(((unexpectedErrors / Math.max(1, totalRequests)) * 100).toFixed(2)),
    latencyMs: {
      min: Number((sorted[0] ?? 0).toFixed(2)),
      mean: Number((sum / Math.max(1, sorted.length)).toFixed(2)),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    },
  };
}

async function httpJson(path, { method = "GET", body, cookie } = {}) {
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: base,
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const elapsedMs = performance.now() - started;
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, json, elapsedMs };
}

async function runPool(totalTasks, concurrency, workerFn) {
  let cursor = 0;
  const results = new Array(totalTasks);
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= totalTasks) break;
      results[idx] = await workerFn(idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const statusRes = await httpJson("/api/auth/status");
  assert.equal(statusRes.status, 200, `Expected 200 on /api/auth/status, got ${statusRes.status}`);

  let cookie;
  if (!statusRes.json.initialized) {
    const reg = await httpJson("/api/auth/register", {
      method: "POST",
      body: { fullName: "Perf Admin", email: adminEmail, password, setupCode },
    });
    assert.equal(reg.status, 201, `Register failed: ${JSON.stringify(reg.json)}`);
    cookie = reg.headers.get("set-cookie")?.split(";")[0];
  } else {
    const loginEmail = process.env.BIDAFLOW_PERF_EMAIL || adminEmail;
    const loginPassword = process.env.BIDAFLOW_PERF_PASSWORD || password;
    const login = await httpJson("/api/auth/login", {
      method: "POST",
      body: { identity: loginEmail, password: loginPassword },
    });
    assert.equal(login.status, 200, `Login failed: ${JSON.stringify(login.json)}`);
    cookie = login.headers.get("set-cookie")?.split(";")[0];
  }
  assert.ok(cookie, "Session cookie missing");

  const action = async (act, payload = {}) => httpJson("/api/action", { method: "POST", body: { action: act, payload }, cookie });

  // Seed realistic dataset: 2 areas, 2 types, 12 tables, 5 products, 1 open shift
  const area = (await action("area.save", { code: `PA-${stamp}`, name: `Khu Perf ${stamp}` })).json.data.id;
  const tableType = (await action("tableType.save", { code: `PT-${stamp}`, name: `Pool Perf ${stamp}`, baseHourlyRate: 60000 })).json.data.id;
  const tableIds = [];
  for (let i = 1; i <= 12; i += 1) {
    const res = await action("table.save", { code: `TB-${stamp}-${i}`, name: `Bàn Perf ${i}`, areaId: area, tableTypeId: tableType });
    assert.equal(res.status, 200);
    tableIds.push(res.json.data.id);
  }
  const productRes = await action("product.save", { code: `PR-${stamp}`, name: `Nước Perf ${stamp}`, salePrice: 20000 });
  assert.equal(productRes.status, 200);
  const productId = productRes.json.data.id;
  await action("inventory.move", { productId, type: "IN", quantity: 100, reason: "Seed perf" });
  await action("shift.open", { openingCash: 1_000_000 });

  // Start 4 active sessions and create 6 closed paid invoices for realistic /api/app payload
  for (let i = 0; i < 4; i += 1) {
    const st = await action("session.start", { tableId: tableIds[i] });
    assert.equal(st.status, 200);
    await action("order.add", { sessionId: st.json.data.sessionId, productId, quantity: 1 });
  }
  for (let i = 4; i < 10; i += 1) {
    const st = await action("session.start", { tableId: tableIds[i] });
    const sid = st.json.data.sessionId;
    await action("session.end", { sessionId: sid });
    const inv = await action("invoice.create", { sessionId: sid });
    if (inv.json.data.total > 0) {
      await action("invoice.pay", { invoiceId: inv.json.data.invoiceId, method: "CASH", amount: inv.json.data.total });
    }
  }

  // Workload 1: Read /api/app across concurrency levels (c=1, c=5, c=15)
  const readBenchmarks = {};
  for (const [concurrency, totalRequests] of [[1, 20], [5, 40], [15, 60]]) {
    const t0 = performance.now();
    const outcomes = await runPool(totalRequests, concurrency, () => httpJson("/api/app", { cookie }));
    const wallMs = performance.now() - t0;
    const errors = outcomes.filter((r) => r.status !== 200).length;
    readBenchmarks[`c${concurrency}`] = summarizeLatencies(
      outcomes.map((r) => r.elapsedMs),
      wallMs,
      errors,
      totalRequests,
    );
  }

  // Workload 2: Concurrency contention + DB invariant checks against real Worker/D1
  // 2a: 8 concurrent session.start on tableIds[10] -> exactly 1 succeeds
  const startBurst = await Promise.all(
    Array.from({ length: 8 }, () => action("session.start", { tableId: tableIds[10] })),
  );
  const startWins = startBurst.filter((r) => r.status === 200).length;
  assert.equal(startWins, 1, `Expected 1 session.start win, got ${startWins}`);
  const contestedSessionId = startBurst.find((r) => r.status === 200).json.data.sessionId;

  // 2b: 8 concurrent inventory.move IN (+5 each) -> stock goes 100 -> 140
  const invInBurst = await Promise.all(
    Array.from({ length: 8 }, (_, idx) => action("inventory.move", { productId, type: "IN", quantity: 5, reason: `Perf IN ${idx}` })),
  );
  assert.equal(invInBurst.filter((r) => r.status === 200).length, 8);

  // 2c: 5 concurrent inventory.move OUT (-40 each from 140) -> at most 3 succeed (140 -> 20)
  const invOutBurst = await Promise.all(
    Array.from({ length: 5 }, (_, idx) => action("inventory.move", { productId, type: "OUT", quantity: 40, reason: `Perf OUT ${idx}` })),
  );
  const outWins = invOutBurst.filter((r) => r.status === 200).length;
  assert.equal(outWins, 3, `Expected 3 OUT wins from stock=140, got ${outWins}`);

  // 2d: Add/serve order item, close contestedSessionId + 6 concurrent invoice.create -> exactly 1 invoice
  const addedItem = await action("order.add", { sessionId: contestedSessionId, productId, quantity: 2 });
  assert.equal(addedItem.status, 200);
  const servedItem = await action("order.item.status", { itemId: addedItem.json.data.itemId, status: "SERVED" });
  assert.equal(servedItem.status, 200);
  await action("session.end", { sessionId: contestedSessionId });
  const invCreateBurst = await Promise.all(
    Array.from({ length: 6 }, () => action("invoice.create", { sessionId: contestedSessionId })),
  );
  assert.equal(invCreateBurst.filter((r) => r.status === 200).length, 1);
  const contestedInvoiceId = invCreateBurst.find((r) => r.status === 200).json.data.invoiceId;
  const contestedTotal = invCreateBurst.find((r) => r.status === 200).json.data.total;

  // 2e: 6 concurrent invoice.pay on same invoice -> exactly 1 payment if total > 0
  let payWins = 0;
  if (contestedTotal > 0) {
    const payBurst = await Promise.all(
      Array.from({ length: 6 }, () => action("invoice.pay", { invoiceId: contestedInvoiceId, method: "CASH", amount: contestedTotal })),
    );
    payWins = payBurst.filter((r) => r.status === 200).length;
    assert.equal(payWins, 1, `Expected 1 invoice.pay win, got ${payWins}`);
  }

  // Verify final DB invariants via /api/app
  const finalApp = await httpJson("/api/app", { cookie });
  assert.equal(finalApp.status, 200);
  const finalProduct = finalApp.json.products.find((p) => p.id === productId);
  assert.equal(finalProduct.stock_quantity, 18, `Expected stock=18, got ${finalProduct.stock_quantity}`);
  const matchingInvoices = finalApp.json.invoices.filter((i) => i.session_id === contestedSessionId && i.status !== "CANCELLED");
  assert.equal(matchingInvoices.length, 1);
  if (contestedTotal > 0) {
    assert.equal(matchingInvoices[0].status, "PAID");
    assert.equal(matchingInvoices[0].paid_amount, contestedTotal);
    const matchingPayments = finalApp.json.payments.filter((p) => p.invoice_id === contestedInvoiceId);
    assert.equal(matchingPayments.length, 1);
  }

  const report = {
    environment: {
      targetUrl: base,
      runtime: "wrangler dev --local (Miniflare + local D1)",
      nodeVersion: process.version,
      datasetSeed: { areas: 1, tables: 12, activeSessions: 4, paidInvoices: 6, products: 1 },
      slaThresholdStatus: "UNSET (baseline measurement only; no official SLA/SLO approved in repo/issue #54)",
    },
    readBenchmarks,
    concurrencyInvariants: {
      sessionStart8x: { wins: startWins, expectedWins: 1 },
      inventoryIn8x: { wins: 8, expectedStock: 140 },
      inventoryOut5x: { wins: outWins, expectedWins: 3, finalStock: finalProduct.stock_quantity },
      invoiceCreate6x: { wins: invCreateBurst.filter((r) => r.status === 200).length, expectedWins: 1 },
      invoicePay6x: { total: contestedTotal, wins: payWins, expectedWins: contestedTotal > 0 ? 1 : 0 },
      allInvariantsPassed: true,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
