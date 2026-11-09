import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rehearseD1Lifecycle } from "../scripts/rehearse-d1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("BF-DB-01: D1 Migration, Backup and Recovery Lifecycle", () => {
  test("Executes full lifecycle rehearsal: clean init, migration, seed, export, isolated restore, and PRAGMA integrity_check", async () => {
    const result = await rehearseD1Lifecycle({
      verbose: false,
      workDir: path.join(root, ".test-db-rehearsal-unit"),
      migrationPath: path.join(root, "drizzle", "0000_natural_silvermane.sql"),
      keepArtifacts: false,
    });

    assert.equal(result.success, true);
    assert.ok(result.tableCount >= 30, `Expected at least 30 tables in restored database, got ${result.tableCount}`);
  });
});
