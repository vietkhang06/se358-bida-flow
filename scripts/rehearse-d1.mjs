#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Rehearsal script for D1 migration, backup and recovery.
 * Uses an isolated, dedicated temporary SQLite database to simulate D1 lifecycle.
 * NEVER connects to or modifies production databases.
 */
export async function rehearseD1Lifecycle(options = {}) {
  const verbose = options.verbose ?? true;
  const log = (...args) => { if (verbose) console.log(...args); };

  const scriptDir = path.dirname(path.resolve(process.argv[1] || "."));
  const repoRoot = path.resolve(scriptDir, "..");
  const defaultWorkDir = path.join(repoRoot, ".test-db-rehearsal");
  const defaultMigrationPath = path.join(repoRoot, "drizzle", "0000_natural_silvermane.sql");

  const workDir = path.resolve(options.workDir || defaultWorkDir);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

  const primaryDbPath = path.join(workDir, "primary-rehearsal.sqlite");
  const backupSqlPath = path.join(workDir, "backup-rehearsal.sql");
  const restoredDbPath = path.join(workDir, "restored-rehearsal.sqlite");

  // Clean previous rehearsal artifacts if any
  for (const p of [primaryDbPath, backupSqlPath, restoredDbPath]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  log("=== BF-DB-01: D1 Migration, Backup & Recovery Rehearsal ===");

  // Step 1: Clean database initialization & migration
  log("\n[Step 1] Initializing clean database and applying D1 migrations...");
  const migrationSqlPath = path.resolve(options.migrationPath || defaultMigrationPath);
  if (!fs.existsSync(migrationSqlPath)) {
    throw new Error(`Migration SQL file not found at ${migrationSqlPath}`);
  }
  const migrationSql = fs.readFileSync(migrationSqlPath, "utf8");

  const primaryDb = new DatabaseSync(primaryDbPath);
  primaryDb.exec(migrationSql);

  // Verify tables were created
  const tables = primaryDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  log(`✓ Applied migration successfully. Created ${tables.length} tables:`, tables.map(t => t.name).join(", "));
  if (tables.length < 15) throw new Error("Expected at least 15 core tables after migration");

  // Step 2: Seed representative data
  log("\n[Step 2] Inserting representative dataset into primary database...");
  primaryDb.exec(`
    INSERT INTO areas (id, code, name, sort_order, active) VALUES ('area_test', 'KV_TEST', 'Khu Rehearsal', 1, 1);
    INSERT INTO table_types (id, code, name, base_hourly_rate, color, active) VALUES ('type_test', 'POOL_TEST', 'Bàn Test', 50000, '#16a085', 1);
    INSERT INTO billiard_tables (id, code, name, area_id, table_type_id, status, active) VALUES ('tbl_test', 'B_TEST', 'Bàn Thử Nghiệm', 'area_test', 'type_test', 'AVAILABLE', 1);
    INSERT INTO product_categories (id, code, name, sort_order, active) VALUES ('cat_test', 'CAT_TEST', 'Danh Mục Test', 1, 1);
    INSERT INTO products (id, code, name, category_id, kind, unit, sale_price, cost_price, stock_quantity, min_stock, track_stock, active)
      VALUES ('prod_test', 'P_TEST', 'Nước Ngọt Test', 'cat_test', 'PRODUCT', 'Lon', 15000, 10000, 50, 10, 1, 1);
    INSERT INTO customers (id, code, full_name, phone, active) VALUES ('cust_test', 'KH_TEST', 'Khách Hàng Test', '0912345678', 1);
    INSERT INTO roles (id, code, name, is_system) VALUES ('role_admin', 'ADMIN', 'Quản trị hệ thống', 1);
    INSERT INTO users (id, email, username, full_name, password_hash, password_salt, role_id, status)
      VALUES ('usr_test', 'test@bidaflow.vn', 'testuser', 'Test Admin', 'hash', 'salt', 'role_admin', 'ACTIVE');
  `);
  log("✓ Seeded representative areas, tables, products, customers, and users.");

  // Step 3: Backup / export procedure
  log("\n[Step 3] Performing database export / backup...");
  // SQLite export using schema + table dumps
  const dumpLines = [];
  dumpLines.push("PRAGMA foreign_keys=OFF;");
  dumpLines.push("BEGIN TRANSACTION;");

  // Get table definitions
  for (const table of tables) {
    const tableDef = primaryDb.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table.name);
    if (tableDef?.sql) dumpLines.push(`${tableDef.sql};`);

    // Dump rows
    const rows = primaryDb.prepare(`SELECT * FROM ${table.name}`).all();
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number") return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      dumpLines.push(`INSERT INTO ${table.name} (${cols.map(c => `"${c}"`).join(",")}) VALUES (${vals.join(",")});`);
    }
  }

  // Get indexes
  const indexes = primaryDb.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
  ).all();
  for (const idx of indexes) {
    dumpLines.push(`${idx.sql};`);
  }

  dumpLines.push("COMMIT;");
  const backupSql = dumpLines.join("\n");
  fs.writeFileSync(backupSqlPath, backupSql, "utf8");
  log(`✓ Backup successfully generated at ${backupSqlPath} (${fs.statSync(backupSqlPath).size} bytes).`);

  // Close primary DB to ensure clean state
  primaryDb.close();

  // Step 4: Recovery / restore procedure into isolated test database
  log("\n[Step 4] Restoring into isolated recovery test database...");
  const restoredDb = new DatabaseSync(restoredDbPath);
  restoredDb.exec(fs.readFileSync(backupSqlPath, "utf8"));
  log("✓ Executed restoration script into target recovery database.");

  // Step 5: Verification of restored schema and data integrity
  log("\n[Step 5] Verifying integrity of restored database...");
  const restoredTables = restoredDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  if (restoredTables.length !== tables.length) {
    throw new Error(`Restored table count mismatch: expected ${tables.length}, got ${restoredTables.length}`);
  }

  const restoredProduct = restoredDb.prepare("SELECT * FROM products WHERE id = 'prod_test'").get();
  if (!restoredProduct || restoredProduct.stock_quantity !== 50 || restoredProduct.name !== "Nước Ngọt Test") {
    throw new Error("Restored product record integrity check failed");
  }

  const restoredCustomer = restoredDb.prepare("SELECT * FROM customers WHERE id = 'cust_test'").get();
  if (!restoredCustomer || restoredCustomer.phone !== "0912345678") {
    throw new Error("Restored customer record integrity check failed");
  }

  // Foreign key / integrity check
  const integrity = restoredDb.prepare("PRAGMA integrity_check").get();
  log(`✓ SQLite integrity check result: ${integrity?.integrity_check ?? JSON.stringify(integrity)}`);
  if (integrity?.integrity_check !== "ok") throw new Error("Restored database failed integrity_check");

  restoredDb.close();

  // Cleanup rehearsal artifacts unless keepArtifacts requested
  if (!options.keepArtifacts) {
    for (const p of [primaryDbPath, backupSqlPath, restoredDbPath]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (fs.existsSync(workDir)) fs.rmdirSync(workDir);
    log("\n[Cleanup] Cleaned up temporary test databases.");
  }

  log("\n=== BF-DB-01: Rehearsal COMPLETED SUCCESSFULLY ===");
  return { success: true, tableCount: restoredTables.length };
}

import { pathToFileURL } from "node:url";

// Allow direct CLI execution
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  rehearseD1Lifecycle({ keepArtifacts: false }).catch(err => {
    console.error("Rehearsal failed:", err);
    process.exit(1);
  });
}
