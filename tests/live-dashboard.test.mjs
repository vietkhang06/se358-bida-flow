import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { operationsFixture } from "./helpers/operations-fixture.mjs";
import { createJsonRequest } from "./helpers/test-fixture.mjs";
import {
  ApiRequestError,
  classifySyncError,
  createLatestSyncGuard,
  summarizeTableStatuses,
} from "../lib/live-sync.ts";

describe("BF-PROD-01: Live sync guard, error classification, and status summary", () => {
  test("prevents duplicate background polls, aborts stale fetches on force refresh, and cleans up on invalidate", () => {
    const guard = createLatestSyncGuard();
    const t1 = guard.begin(false);
    assert.ok(t1);
    assert.equal(guard.isInFlight(), true);

    // Duplicate background poll while t1 is in flight must be skipped
    assert.equal(guard.begin(false), null);
    assert.equal(guard.isCurrent(t1.seq), true);

    // Forced refresh aborts t1 and supersedes its sequence number
    const t2 = guard.begin(true);
    assert.ok(t2);
    assert.equal(t1.signal.aborted, true);
    assert.equal(guard.isCurrent(t1.seq), false);
    assert.equal(guard.isCurrent(t2.seq), true);

    // Finishing stale t1 must not clear t2 in-flight state
    guard.finish(t1.seq);
    assert.equal(guard.isInFlight(), true);
    assert.equal(guard.isCurrent(t2.seq), true);

    // Logout/unmount invalidation aborts t2 cleanly
    guard.invalidate();
    assert.equal(t2.signal.aborted, true);
    assert.equal(guard.isCurrent(t2.seq), false);
    assert.equal(guard.isInFlight(), false);
  });

  test("classifies abort, 401 unauthorized, offline network, and server errors distinctly", () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    assert.equal(classifySyncError(abortErr, true).kind, "abort");

    assert.equal(classifySyncError(new ApiRequestError("Phiên hết hạn", 401), true).kind, "unauthorized");
    assert.equal(classifySyncError(new TypeError("Failed to fetch"), true).kind, "offline");
    assert.equal(classifySyncError(new Error("Any"), false).kind, "offline");
    assert.equal(classifySyncError(new ApiRequestError("Server error", 500), true).kind, "server");
  });

  test("summarizes effective table statuses consistently", () => {
    assert.deepEqual(
      summarizeTableStatuses([
        { status: "AVAILABLE" },
        { status: "PLAYING" },
        { status: "RESERVED" },
        { status: "MAINTENANCE" },
        { status: "AVAILABLE" },
      ]),
      { total: 5, available: 2, playing: 1, reserved: 1, maintenance: 1 },
    );
  });
});

describe("BF-PROD-01: Operational dashboard API live state and RBAC", () => {
  let f;

  beforeEach(async () => {
    f = await operationsFixture();
  });

  afterEach(() => {
    f.db._raw.close();
  });

  test("reflects cross-user table, session, order, and due-reservation state immediately with no-store header", async () => {
    // Initial snapshot for manager
    const initialRes = await f.appRoute.GET(createJsonRequest("http://localhost/api/app", "GET", null, f.managerCookie));
    assert.equal(initialRes.status, 200);
    assert.equal(initialRes.headers.get("cache-control"), "no-store");
    const initial = await initialRes.json();
    assert.equal(initial.summary.table_count, 2);
    assert.equal(initial.summary.available_count, 2);
    assert.equal(initial.summary.playing_count, 0);
    assert.equal(initial.summary.reserved_count, 0);
    assert.equal(initial.summary.maintenance_count, 0);
    assert.equal(initial.summary.open_orders_count, 0);
    assert.ok(initial.summary.snapshot_at);

    // Another user (service) opens a session on b1 and adds an order
    const { sessionId } = (await f.call("session.start", { tableId: "b1" }, "service")).data;
    await f.call("order.add", { sessionId, productId: "p", quantity: 1 }, "service");

    // Cashier creates a due reservation on b2
    await f.call("reservation.save", f.booking({
      tableId: "b2",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    }), "cashier");

    // Manager polling refresh immediately sees cross-user state & aligned summary counts
    const afterOps = await f.read("manager");
    assert.equal(afterOps.tables.find((t) => t.id === "b1").status, "PLAYING");
    assert.equal(afterOps.tables.find((t) => t.id === "b2").status, "RESERVED");
    assert.equal(afterOps.summary.playing_count, 1);
    assert.equal(afterOps.summary.reserved_count, 1);
    assert.equal(afterOps.summary.available_count, 0);
    assert.equal(afterOps.summary.open_orders_count, 1);
    assert.equal(afterOps.sessions.find((s) => s.id === sessionId).status, "ACTIVE");

    // Service closes session (confirming pending order) -> table returns AVAILABLE
    await f.call("session.end", { sessionId, confirmPendingOrders: true }, "service");
    const afterEnd = await f.read("manager");
    assert.equal(afterEnd.tables.find((t) => t.id === "b1").status, "AVAILABLE");
    assert.equal(afterEnd.summary.playing_count, 0);
    assert.equal(afterEnd.summary.available_count, 1);
  });

  test("scopes dashboard summary fields strictly by RBAC permissions", async () => {
    const wh = await f.read("warehouse");
    assert.equal(wh.tables.length, 0);
    assert.equal(wh.sessions.length, 0);
    assert.equal(wh.summary.table_count, undefined);
    assert.equal(wh.summary.playing_count, undefined);
    assert.equal(wh.summary.open_orders_count, undefined);
    assert.equal(wh.summary.today_revenue, undefined);
    assert.equal(typeof wh.summary.low_stock_count, "number");

    const svc = await f.read("service");
    assert.equal(svc.tables.length, 2);
    assert.equal(typeof svc.summary.playing_count, "number");
    assert.equal(typeof svc.summary.open_orders_count, "number");
    assert.equal(svc.summary.today_revenue, undefined);
    assert.equal(svc.summary.low_stock_count, undefined);

    const unauthRes = await f.appRoute.GET(createJsonRequest("http://localhost/api/app", "GET", null));
    assert.equal(unauthRes.status, 401);
  });
});
