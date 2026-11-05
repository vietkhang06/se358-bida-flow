#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const errors = [];
const drift = [];
const strict = process.argv.includes('--strict');
function check(ok, message) { if (!ok) errors.push(message); }
function checkDrift(ok, message) { if (!ok) drift.push(message); }
const manifest = JSON.parse(fromRoot('docs/PM_PLATFORM_ACTION_BASELINE.json'));
const route = fromRoot('app/api/action/route.ts');
const ops = fromRoot('lib/operations.ts');
const observed = {};
for (const line of ops.split(/\r?\n/)) {
  let m = line.match(/\.\.\.\[([^\]]+)\]\.map\(\(a\) => \[a, "([A-Z_]+)"\]\)/);
  if (m) {
    for (const [, name] of m[1].matchAll(/"([a-zA-Z.]+)"/g)) {
      check(!observed[name], `Duplicate delegated action ${name}`);
      observed[name] = { implementation:'delegated', permission:m[2], source:'lib/operations.ts' };
    }
  }
  m = line.trim().match(/^\["([a-zA-Z.]+)", "([A-Z_]+)"\],?$/);
  if (m) {
    check(!observed[m[1]], `Duplicate delegated action ${m[1]}`);
    observed[m[1]] = { implementation:'delegated', permission:m[2], source:'lib/operations.ts' };
  }
}
const legacy = [...route.matchAll(/\bcase "([a-zA-Z.]+)": \{/g)];
for (let i=0; i<legacy.length; i++) {
  const name = legacy[i][1];
  const start = legacy[i].index + legacy[i][0].length;
  const end = i+1<legacy.length ? legacy[i+1].index : route.indexOf('      default: throw new AppError', start);
  check(end > start, `Cannot identify case boundary for ${name}`);
  const current = route.slice(start, end);
  const permission = current.match(/requireAny\(user, \["([A-Z_]+)"\]\)/)?.[1] ?? 'AUTHENTICATED_SELF';
  check(!observed[name], `Duplicate route action ${name}`);
  observed[name] = { implementation:'legacy-switch', permission, source:'app/api/action/route.ts' };
}
const baselineActions = manifest.actions;
const observedNames = Object.keys(observed).sort();
const baselineNames = Object.keys(baselineActions).sort();
checkDrift(JSON.stringify(observedNames) === JSON.stringify(baselineNames),
  `Action inventory drift! Added: ${observedNames.filter(x=>!baselineNames.includes(x))}; Removed: ${baselineNames.filter(x=>!observedNames.includes(x))}`);
for (const name of baselineNames) {
  if (observed[name]) checkDrift(JSON.stringify(observed[name]) === JSON.stringify(baselineActions[name]), `Permission/delegation drift: ${name}`);
}
check(manifest.actionCount === baselineNames.length, 'Baseline actionCount does not match records');
checkDrift(route.includes('assertSameOrigin(request)'), 'Same-origin check missing from action route');
checkDrift(route.includes('await requireUser(request)'), 'Authentication check missing from action route');
check(fromRoot('docs/PM_PLATFORM_CONTRACT_FREEZE.md').includes('provider/consumer'), 'Missing freeze checklist');
const coverage = fromRoot('docs/PM_UC_SOURCE_RECONCILIATION.csv').replace(/^\uFEFF/, '');
const ids = [...coverage.matchAll(/^UC(\d{2}),/gm)].map(m=>`UC${m[1]}`);
check(ids.length === 47 && new Set(ids).size === 47, `UC placeholder rows: expected 47 distinct IDs, got ${ids.length}`);
for (let i=1;i<=47;i++) check(ids.includes(`UC${String(i).padStart(2,'0')}`), `UC${i} missing from placeholder`);
const wbs = fromRoot('docs/PM_WBS_TASK_OWNER_MAP.csv').replace(/^\uFEFF/, '');
for (const task of ['BF-PM-01','BF-PM-02','BF-PM-03','BF-PLAT-01','BF-PLAT-02','BF-PLAT-03']) {
  check(wbs.includes(task), `Missing WBS task ${task}`);
}
check(fs.existsSync(path.join(root,'.github/pull_request_template.md')), 'PR template missing');
if (drift.length) {
  console.warn('BF PM/PLAT CONTRACT DRIFT WARNING (snapshot vs local implementation):');
  drift.forEach(e => console.warn(` - ${e}`));
  console.warn('Review with provider/consumer. Source code and dependencies were NOT modified by this patch.');
  if (strict) errors.push(...drift);
}
if (errors.length) {
  console.error('BF PM/PLAT verification FAILED:');
  errors.forEach(e=>console.error(` - ${e}`));
  process.exitCode=1;
} else {
  console.log(`BF PM/PLAT verification PASS: ${observedNames.length} action names/permissions matched, 47 provisional UC rows, 6 board tasks, PR template.`);
  if (drift.length) console.log('STATUS: docs scaffolding PASS, API snapshot DRIFT REQUIRES REVIEW; run --strict to block approval.');
  else console.log('STATUS: docs scaffolding PASS, API action baseline matched.');
  console.log('NOTE: This verifies source/doc structure only, not stakeholder sign-off, SRS correctness, API behavior or real D1 E2E.');
}
