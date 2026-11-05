import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('PM/PLAT documents and baseline verifier run (strict contract validation separate)', () => {
  const result = execFileSync(process.execPath, ['scripts/verify-pm-platform.mjs'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.match(result, /verification PASS/);
});
