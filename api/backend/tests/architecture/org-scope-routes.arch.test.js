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
  // Import templates and smart-import column metadata: static files and
  // global counts, no organization data. The file is scoped by its quarantine
  // routes (#800 on this branch, #1352).
  ['import-lgpd.routes.js GET /pacientes/template/csv', 'static import template, no organization data'],
  ['import-lgpd.routes.js GET /pacientes/template/xlsx', 'static import template, no organization data'],
  ['import-lgpd.routes.js GET /amostras/template/csv', 'static import template, no organization data'],
  ['import-lgpd.routes.js GET /amostras/template/xlsx', 'static import template, no organization data'],
  ['import-lgpd.routes.js GET /pacientes/smart-import/metadata', 'column metadata and a global template count, no organization data'],
  // The organization list is the scope's own reference data, which every
  // create form's picker reads, not a record one organization owns; its
  // mutations are manageOrganizations, an Administrador permission. The file
  // reads as scoped only because GET /mine resolves the caller's scope (#1354).
  ['organization.routes.js GET /', 'organizations are the scope reference list, not organization-owned records (#1354)'],
  ['organization.routes.js GET /:id', 'organizations are the scope reference list, not organization-owned records (#1354)'],
  ['organization.routes.js POST /', 'organizations are the scope reference list; manageOrganizations is Administrador-only (#1354)'],
  ['organization.routes.js PUT /:id', 'organizations are the scope reference list; manageOrganizations is Administrador-only (#1354)'],
  ['organization.routes.js DELETE /:id', 'organizations are the scope reference list; manageOrganizations is Administrador-only (#1354)'],
  // An import job belongs to its uploader (importJobs.userID), not to an
  // organization: GET /jobs lists the caller's own, and the job routes
  // refuse any other caller in the controller (#1384).
  ['import.routes.js POST /validate', 'file format check only, no record read'],
  ['import.routes.js GET /jobs', 'self route: lists only the caller\'s own jobs (filters.userID)'],
  ['import.routes.js GET /job/:jobID', 'self route: the controller refuses a job whose userID is not the caller\'s (#1384)'],
  ['import.routes.js POST /job/:jobID/cancel', 'self route: the controller refuses a job whose userID is not the caller\'s (#1384)'],
  ['import.routes.js GET /job/:jobID/report', 'self route: the controller refuses a job whose userID is not the caller\'s (#1384)'],
  // The RNF009 audit trail, gated on isAuditReader in the handler (#1241).
  // An auditor reads it across organizations, the same rule /api/logs keeps.
  ['user.routes.js GET /logs', 'audit trail: isAuditReader reads it across organizations, as /api/logs does (#1384)'],
  // The file became visible to this sweep when the staff signed-term route
  // took requireOrganizationScope. These registrations stay outside that gate.
  ['eConsent.js POST /generate-link', 'invitation addressed to one participant, gated by requestConsent'],
  ['eConsent.js GET /validate/:token', 'participant link, no staff organization'],
  ['eConsent.js POST /update', 'participant link, no staff organization'],
  ['eConsent.js GET /import/fhir/consent/:token', 'participant link, no staff organization'],
  ['eConsent.js POST /import/fhir/consent/:token/accept', 'participant link, no staff organization'],
  ['eConsent.js GET /consent-policies/:id/pending-patients', 'role 3/4 catalog of who still owes a term'],
  ['eConsent.js POST /consent-templates', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-templates', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /purpose-codes', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-templates/current', 'the term a participant or collector is shown'],
  ['eConsent.js GET /consent-templates/active', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-templates/:id', 'global consent catalog, role 3/4'],
  ['eConsent.js PUT /consent-templates/:id', 'global consent catalog, role 3/4'],
  ['eConsent.js POST /consent-policies', 'global consent catalog, role 3/4'],
  ['eConsent.js PUT /consent-policies/:id', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-policies/active', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-policies/active-with-caae', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-policies/history', 'global consent catalog, role 3/4'],
  ['eConsent.js GET /consent-policies', 'global consent catalog, role 3/4'],
  ['eConsent.js POST /consents', 'records the term the staff collector just showed, role 3/4'],
  ['eConsent.js POST /consents/:id/revoke', 'staff revocation of one consent, role 3/4'],
  ['eConsent.js GET /consents/:id/history', 'staff read of one consent, role 3/4'],
  ['eConsent.js GET /patients/:participantId/consent', 'staff read of one participant, role 3/4'],
  ['eConsent.js POST /consent-tokens/validate', 'participant link, no staff organization'],
  ['eConsent.js POST /consent-tokens/accept', 'participant link, no staff organization'],
  ['eConsent.js POST /consent-tokens/revoke', 'participant link, no staff organization'],
  ['eConsent.js POST /consent-tokens/signed-tcle', 'participant link, no staff organization'],
]);

// NOT exemptions: routes that DO need the gate and do not have it yet, each
// against the open issue that owns it. Kept apart from EXEMPT so that list
// keeps meaning "needs none". Same stale check: an entry that gains the gate
// fails until it is dropped here.
//
// #1210 scoped storage.routes.js's two topology creates, which made the file
// visible to this sweep for the first time; the rest of it checks no tenancy
// at all, the mutations included (#1211).
// #1211 scoped all thirteen, mutations and reads, and emptied this list. It
// stays, with its stale check, as the place the next known gap is recorded.
// #1353 gated the four LGPD import routes it held and emptied it again.
// #1384 listed these when it brought import.routes.js into the sweep.
// #1385 gated the quarantine and FHIR batch routes and emptied it again.
const TRACKED_UNSCOPED = new Map([
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
  const ungated = registrations
    .filter((r) => !r.gated && !EXEMPT.has(r.key) && !TRACKED_UNSCOPED.has(r.key))
    .map((r) => r.key);
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

test('#1211: every TRACKED_UNSCOPED entry still names an ungated registration', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  const stale = [...TRACKED_UNSCOPED.keys()].filter((key) => !byKey.has(key) || byKey.get(key).gated);
  assert.deepEqual(stale, [], 'TRACKED_UNSCOPED names a route that is gone or now gated -- drop it, and update its issue');
});

// #1210: the two topology creates are scoped. Pinned by name, because the
// sweep's general rule would also pass if they were merely added to one of
// the two lists above.
test('#1210: the storage topology creates carry the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const key of ['storage.routes.js POST /topology/containers', 'storage.routes.js POST /topology/boxes']) {
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

// #1211: the storage mutations are scoped. Pinned by name, for the same
// reason as the #1210 test above.
test('#1211: the storage allocation mutations and the freezer room PATCH carry the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const route of ['POST /allocate', 'POST /allocate/auto', 'POST /move', 'DELETE /release/:sampleId', 'PATCH /freezer/:freezerId/room']) {
    const key = `storage.routes.js ${route}`;
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

test('#1211: the eight storage reads carry the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const route of [
    'GET /freezers',
    'GET /samples/search',
    'GET /sample/:sampleId',
    'GET /box/:boxId/available',
    'GET /validate/:boxId/:position',
    'GET /freezer/:freezerId/stats',
    'GET /box/:boxId/integrity',
    'GET /freezer/:freezerId/tree',
  ]) {
    const key = `storage.routes.js ${route}`;
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

// #1385: the FHIR staging batches and the async quarantine batches carry the
// creator's organizationId, and every route that reads or acts on one checks
// it against the caller's scope. Pinned by name, as above.
test('#1385: the quarantine and FHIR batch routes carry the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const route of [
    'GET /batch/quarantine/:id',
    'POST /fhir/stage',
    'GET /fhir/batches/:id',
    'POST /fhir/batches/:id/validate',
    'POST /fhir/batches/:id/send-consents',
    'GET /fhir/batches/:id/consent-status',
    'POST /fhir/batches/:id/commit',
    'POST /fhir/batches/:id/records/:recordId/external-document',
  ]) {
    const key = `import.routes.js ${route}`;
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

// #1384: the import creates resolve the caller's scope at the route, and the
// staging-batch reads check the batch's organization against it. Pinned by
// name, for the same reason as the #1210 test above.
test('#1384: the import creates and staging-batch reads carry the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const route of [
    'POST /batch',
    'POST /import',
    'POST /import/samples',
    'POST /upload',
    'GET /batch/:jobId',
    'GET /status/:jobId',
  ]) {
    const key = `import.routes.js ${route}`;
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

// #1384: user management is limited to the caller's organizations. Every
// user route but the audit trail runs the gate and checks the target user's
// organizations against it. Pinned by name, as above.
test('#1384: every user.routes.js registration but GET /logs carries the organization gate', () => {
  const { registrations } = sweep();
  const byKey = new Map(registrations.map((r) => [r.key, r]));
  for (const route of [
    'POST /register',
    'GET /',
    'GET /:id',
    'PUT /:id',
    'GET /:id/organizations',
    'POST /:id/organizations',
    'DELETE /:id/organizations/:organizationId',
    'DELETE /:id',
    'GET /:id/validate-status',
    'POST /register-patient',
    'POST /register-sample',
    'POST /record-withdrawal',
    'POST /generate-report',
    'POST /register-sensor',
    'POST /:id/reset-mfa',
    'POST /:id/revoke-sessions',
    'POST /:id/force-password-reset',
    'POST /:id/set-password',
    'POST /:id/disable-mfa',
  ]) {
    const key = `user.routes.js ${route}`;
    assert.ok(byKey.has(key), `${key} not found by the sweep`);
    assert.equal(byKey.get(key).gated, true, `${key} is not organization-scoped`);
    assert.equal(EXEMPT.has(key) || TRACKED_UNSCOPED.has(key), false, `${key} must not be listed as unscoped`);
  }
});

// ---------------------------------------------------------------------------
// #1189: the ALLOWLIST arm. A module whose update allowlist lets the caller
// write the very field the module scopes on must refuse a move between
// organizations on the destination side, through
// assertOrganizationFieldNotReparented. The allowlist and that check live
// in different files for sensor and sample (service vs controller/route),
// so the pairing is declared here rather than inferred: every allowlist in
// src/ holding a scope-field name must appear in SCOPE_FIELD_GUARDS (and its
// guard must still call the helper with that field) or in
// SCOPE_FIELD_EXEMPT with the reason it is not a tenancy key.
// ---------------------------------------------------------------------------

const SCOPE_FIELD_NAMES = ['organizationId', 'organizationIds', 'collectionSite', 'clinicalUnitId', 'laboratoryId'];

// key: '<allowlist file relative to src> <field>'
// guard: file (relative to src) whose assertOrganizationFieldNotReparented(
// call arguments must contain `token`.
const SCOPE_FIELD_GUARDS = new Map([
  ['services/sensor.service.js organizationId', { guard: 'controllers/sensor.controller.js', token: 'organizationId' }], // 5c776c4d
  ['services/sample.service.js collectionSite', { guard: 'interface/routes/sample.routes.js', token: "'collectionSite'" }], // 7a8a3d7e
  ['interface/routes/equipment.routes.js organizationId', { guard: 'interface/routes/equipment.routes.js', token: 'organizationId' }], // 67b7b35e
  // The factory passes its scopeField through; app.js must set it to
  // laboratoryId on the assays mount -- asserted separately below.
  ['interface/routes/master-data.routes.js laboratoryId', { guard: 'interface/routes/master-data.routes.js', token: 'scopeField' }], // e2d2058b
]);

const SCOPE_FIELD_EXEMPT = new Map([
  // A user's own organizationId/organizationIds are profile data, not the
  // tenancy key: resolveUserOrganizationScope reads UserRoleAssignment
  // scopeId only (rbac-assignment.service.js), so writing them moves no
  // record between organizations.
  ['interface/routes/user.routes.js organizationId', 'user profile field; scope resolves from UserRoleAssignment.scopeId'],
  ['interface/routes/user.routes.js organizationIds', 'user profile field; scope resolves from UserRoleAssignment.scopeId'],
]);

const ALLOWLIST_DECL = /\bconst\s+(ALLOWED_\w*UPDATE_FIELDS|HAND_ENUMERATED_UPDATE_FIELDS)\s*=\s*[[{]/g;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function allowlistScopeFields() {
  const found = [];
  let allowlists = 0;
  for (const file of sourceFiles(BACKEND_SRC)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(ALLOWLIST_DECL)) {
      allowlists += 1;
      const close = code.slice(m.index).search(/\n\s*[\]}];/);
      const body = code.slice(m.index, close === -1 ? undefined : m.index + close);
      const rel = path.relative(BACKEND_SRC, file).split(path.sep).join('/');
      for (const field of SCOPE_FIELD_NAMES) {
        if (new RegExp(`['"]${field}['"]`).test(body)) found.push(`${rel} ${field}`);
      }
    }
  }
  return { found: [...new Set(found)], allowlists };
}

test('#1189: the allowlist sweep finds real allowlists and scope fields in them', () => {
  const { found, allowlists } = allowlistScopeFields();
  // 2026-09-24: 8 allowlist declarations, 6 scope-field entries in them.
  assert.ok(allowlists >= 6, `only ${allowlists} update allowlists found`);
  assert.ok(found.length >= 4, `only ${found.length} scope fields found in allowlists`);
});

test('#1189: every update allowlist holding a scope field is paired with the re-parent check', () => {
  const { found } = allowlistScopeFields();
  const unpaired = found.filter((key) => !SCOPE_FIELD_GUARDS.has(key) && !SCOPE_FIELD_EXEMPT.has(key));
  assert.deepEqual(unpaired, [],
    'An update allowlist lets the caller write the field its module scopes on, so an in-scope caller ' +
    'can move a record into another organization. Call assertOrganizationFieldNotReparented on that ' +
    'update and add the pair to SCOPE_FIELD_GUARDS, or add it to SCOPE_FIELD_EXEMPT with the reason ' +
    'the field is not a tenancy key.');
});

test('#1189: every declared guard still calls the re-parent check with its field', () => {
  const missingGuard = [];
  for (const [key, { guard, token }] of SCOPE_FIELD_GUARDS) {
    const code = stripComments(fs.readFileSync(path.join(BACKEND_SRC, guard), 'utf8'));
    const calls = [...code.matchAll(/assertOrganizationFieldNotReparented\(([\s\S]*?)\);/g)].map((m) => m[1]);
    if (!calls.some((args) => args.includes(token))) missingGuard.push(`${key} -> ${guard}`);
  }
  assert.deepEqual(missingGuard, [], 'a declared guard no longer calls assertOrganizationFieldNotReparented with its field');
});

test('#1189: every SCOPE_FIELD_GUARDS/SCOPE_FIELD_EXEMPT entry still names a live allowlist field', () => {
  const { found } = allowlistScopeFields();
  const live = new Set(found);
  const stale = [...SCOPE_FIELD_GUARDS.keys(), ...SCOPE_FIELD_EXEMPT.keys()].filter((key) => !live.has(key));
  assert.deepEqual(stale, [], 'an entry names an allowlist field that is gone -- drop it');
});

test('#1189: the assays mount still passes scopeField laboratoryId to the factory', () => {
  const appJs = fs.readFileSync(path.resolve(BACKEND_SRC, '../app.js'), 'utf8');
  assert.match(appJs, /app\.use\("\/api\/assays", createMasterDataRouter\(\{[\s\S]*?scopeField: "laboratoryId"[\s\S]*?\}\)\);/);
});
