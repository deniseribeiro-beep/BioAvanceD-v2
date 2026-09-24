// node:test-only by contract, like every *.arch.test.js here: it reads source
// text and needs no database, app or vitest.
//
// #1183: the invariant #1053 enforced module by module, by hand -- "every
// route over a scoped resource carries the same organization gate its
// siblings do". Nothing pinned it, so each gap was found by a person with a
// grep: sensor, equipment and result (#1053), the assay record (#1182), four
// creates/reads/deletes (#1185), two sample reads (#1187). This guard makes
// the next one a red test instead of a finding.
//
// A route file is SCOPED when its code (comments stripped, so a header that
// merely names the middleware does not count) uses either scope mechanism
// this repo has: the requireOrganizationScope middleware, or inline
// resolveUserOrganizationScope (reports.routes.js's house pattern, #637).
// In a scoped file every registration must be scoped by one of:
//   - requireOrganizationScope in its own middleware list,
//   - a router-level router.use(requireOrganizationScope ...),
//   - an inline resolveUserOrganizationScope( call in its handler,
// or be named in EXEMPT below with its reason. Exemptions are keyed by
// file + verb + path, never by line, so an unrelated edit cannot shift one
// out of date; an exemption that no longer matches anything fails too.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve(__dirname, '../../src');
// Same discovery as rbac-actions.arch.test.js.
const ROUTE_DIRS = [
  path.resolve(BACKEND_SRC, 'routes'),
  path.resolve(BACKEND_SRC, 'interface/routes'),
];

const EXEMPT = new Map([
  // Machine ingest: no user, so no scope to resolve; the controller branches
  // before resolveOrganizationIdForCreate (#1071).
  ['temperature.routes.js POST /system/reading', 'machine ingest has no caller scope (#1071)'],
  // A participantId FORMAT check -- reads no patient record.
  ['patient.routes.js POST /validate-id', 'format check only, no record read'],
  // Scoped inside buildPreviewData per handlerKey (SCOPED_HANDLER_KEYS, #341),
  // which is a function call away from this handler and so invisible here.
  ['reports.routes.js POST /:type/preview', 'scoped in buildPreviewData per handlerKey (#341)'],
  ['reports.routes.js GET /:type/export', 'scoped in buildPreviewData per handlerKey (#341)'],
  ['reports.routes.js GET /:type/export/pdf', 'scoped in buildPreviewData per handlerKey (#341)'],
  // Template metadata for a report type -- no organization-owned data.
  ['reports.routes.js GET /:type/filters', 'report-type filter metadata, no organization data'],
]);

function routeFiles() {
  const files = [];
  for (const dir of ROUTE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.js$/.test(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

// Block comments, then line comments that start a line or follow
// whitespace -- the latter so a '//' inside a URL string survives.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const REGISTRATION = /\brouter\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sweep() {
  const registrations = [];
  let scopedFiles = 0;
  for (const file of routeFiles()) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const scoped = code.includes('requireOrganizationScope') || code.includes('resolveUserOrganizationScope(');
    if (!scoped) continue;
    scopedFiles += 1;
    const routerLevel = /\brouter\.use\(\s*requireOrganizationScope\b/.test(code);
    const matches = [...code.matchAll(REGISTRATION)];
    matches.forEach((m, i) => {
      const end = i + 1 < matches.length ? matches[i + 1].index : code.length;
      const segment = code.slice(m.index, end);
      registrations.push({
        key: `${path.basename(file)} ${m[1].toUpperCase()} ${m[3]}`,
        verb: m[1].toUpperCase(),
        gated: routerLevel
          || segment.includes('requireOrganizationScope')
          || segment.includes('resolveUserOrganizationScope('),
      });
    });
  }
  return { registrations, scopedFiles };
}

test('#1183: the sweep reads real route files and finds registrations', () => {
  const { registrations, scopedFiles } = sweep();
  // A regex that stops matching would make every assertion below pass
  // vacuously; these floors are well under the 2026-09-24 population
  // (55 route files, 9 of them scoped, holding 88 registrations of which 41
  // are mutating).
  assert.ok(scopedFiles >= 8, `only ${scopedFiles} scoped route files found`);
  assert.ok(registrations.filter((r) => MUTATING.has(r.verb)).length >= 30, 'too few mutating registrations found');
});

test('#1183: every registration in a scoped route file carries the organization gate', () => {
  const { registrations } = sweep();
  const ungated = registrations.filter((r) => !r.gated && !EXEMPT.has(r.key)).map((r) => r.key);
  assert.deepEqual(ungated, [],
    'A route over an organization-scoped resource answers every caller, whatever their organization. ' +
    'Add requireOrganizationScope (or inline resolveUserOrganizationScope) and a record-level check, ' +
    'or add the route to EXEMPT with the reason it needs none.');
});

test('#1183: every EXEMPT entry still names an ungated registration', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  const stale = [...EXEMPT.keys()].filter((key) => !byKey.has(key) || byKey.get(key).gated);
  assert.deepEqual(stale, [], 'EXEMPT names a route that is gone or now gated -- drop it');
});
