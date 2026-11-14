// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375.
//
// #1552: POST /api/incidents/create was registered with no middleware at all,
// and app.js mounts its router with none in front, so an anonymous caller could
// open a cold-chain incident -- which quarantines samples and emails the alert
// recipients. No guard caught it: helpers/route-gate-sites.js extracts only
// requirePermission/requireRole sites and has no rule that a route must
// authenticate, and org-scope-routes.arch.test.js skips incident.routes.js
// because that file is not organization-scoped.
//
// The rule: every router.<verb>( registration in the comment-stripped source
// of the two route directories is GATED when its own argument list names one
// of the credential gates below, or an earlier router.use( in the same file
// does. Otherwise it is named in EXEMPT with its reason. Exemptions are keyed
// by file + verb + path, never by line, so an unrelated edit cannot shift one
// out of date; an exemption that no longer matches anything fails too.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');

const { routeFiles, relative, argsAt } = require('./helpers/route-gate-sites');
const { readStripped, stripComments } = require('./helpers/strip-comments');

// Same registration pattern as the helper's ROUTE_START.
const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/gi;
const ROUTER_USE = /\brouter\.use\s*\(/g;
const CREDENTIAL_GATE = /\b(authenticate|requireMachineIngestSecret|requireTestSupportSecret)\b/;

const UNJUDGED = 'pre-existing unauthenticated route, not judged by #1552';

const EXEMPT = new Map([
  // Mounted only behind interface/routes/dictionary.routes.js's
  // router.use(authenticate, dictionaryRouter); the bare file exists for its
  // own unit tests.
  ['routes/dictionary.js GET /atc/search', 'mounted only behind dictionary.routes.js router.use(authenticate)'],
  ['routes/dictionary.js GET /search', 'mounted only behind dictionary.routes.js router.use(authenticate)'],
  ['routes/dictionary.js GET /suggest', 'mounted only behind dictionary.routes.js router.use(authenticate)'],
  ['routes/dictionary.js GET /disease-profile', 'mounted only behind dictionary.routes.js router.use(authenticate)'],
  ['routes/dictionary.js GET /medications/search', 'mounted only behind dictionary.routes.js router.use(authenticate)'],

  // Mounted only behind interface/routes/intakeWizard.routes.js's
  // router.use(authenticate, requirePermission('createSample'), ...).
  ['routes/intakeWizard.js GET /patient-match', 'mounted only behind intakeWizard.routes.js router.use(authenticate)'],
  ['routes/intakeWizard.js POST /', 'mounted only behind intakeWizard.routes.js router.use(authenticate)'],
  ['routes/intakeWizard.js POST /intake-wizard', 'mounted only behind intakeWizard.routes.js router.use(authenticate)'],

  // The pre-session sign-in flow: no session exists yet, and each route
  // checks its own credential.
  ['interface/routes/auth.routes.js POST /login', 'sign-in: the credential is the username, password and MFA code'],
  ['interface/routes/auth.routes.js POST /refresh', 'the HttpOnly refresh-token cookie is the credential, verified against JWT_REFRESH_SECRET'],
  ['interface/routes/auth.routes.js GET /password-policy', 'public strength rules, read before a session exists (#1246)'],
  ['interface/routes/auth.routes.js POST /password-reset/request', 'starts a reset for an email address; no session exists by design'],
  ['interface/routes/auth.routes.js POST /password-reset/reset', 'the reset token in the body is the credential'],
  ['interface/routes/auth.routes.js POST /two-factor/qr-first-login', 'first login: the username and password in the body are the credential'],
  ['interface/routes/auth.routes.js POST /two-factor/enable-first-login', 'first login: the username, password and MFA code in the body are the credential'],

  // RNF029 C5 (#1321): the short-lived file access token is the credential.
  ['interface/routes/file-access.routes.js GET /', 'the short-lived file access token is the credential (#1321)'],

  // Participant-link routes: the participant has no session; each route
  // verifies a consent token (CONSENT_SECRET JWT or the patient's consent
  // token) before it reads or writes.
  ['routes/eConsent.js GET /validate/:token', 'participant link: the CONSENT_SECRET JWT in the path is the credential'],
  ['routes/eConsent.js POST /update', 'participant link: the CONSENT_SECRET JWT in the body is the credential'],
  ['routes/eConsent.js GET /import/fhir/consent/:token', 'participant link: the CONSENT_SECRET JWT in the path is the credential'],
  ['routes/eConsent.js POST /import/fhir/consent/:token/accept', 'participant link: the CONSENT_SECRET JWT in the path is the credential'],
  ['routes/eConsent.js POST /consent-tokens/validate', 'participant link: the patient consent token is the credential (#809)'],
  ['routes/eConsent.js POST /consent-tokens/accept', 'participant link: the patient consent token is the credential'],
  ['routes/eConsent.js POST /consent-tokens/revoke', 'participant link: the patient consent token is the credential'],
  ['routes/eConsent.js POST /consent-tokens/signed-tcle', 'participant link: the patient consent token is the credential'],

  // Terminology reads mounted bare in app.js, and one router app.js never
  // mounts. The code states no reason for either.
  ['routes/hpo.js GET /search', UNJUDGED],
  ['routes/hpo.js GET /:id', UNJUDGED],
  ['routes/orphanet.js GET /search', UNJUDGED],
  ['interface/routes/terminologies.routes.js GET /', UNJUDGED],
  ['routes/orphanet-count.js GET /count', UNJUDGED],
]);

/** Every registration in one file's comment-stripped source, with whether it is gated. */
function registrationsIn(content, file) {
  const uses = [...content.matchAll(ROUTER_USE)].map((m) => ({
    index: m.index,
    args: argsAt(content, m.index + m[0].length - 1) || '',
  }));
  return [...content.matchAll(ROUTE_START)].map((m) => {
    const args = argsAt(content, m.index + m[0].length - 1) || '';
    const ownGate = CREDENTIAL_GATE.test(args);
    const routerGate = uses.some((use) => use.index < m.index && CREDENTIAL_GATE.test(use.args));
    return {
      key: `${relative(file)} ${m[1].toUpperCase()} ${m[3] === undefined ? null : m[3]}`,
      gated: ownGate || routerGate,
    };
  });
}

function realRegistrations() {
  return routeFiles().flatMap((file) => registrationsIn(readStripped(fs, file), file));
}

test('every route registration carries an authentication gate or a reasoned exemption', () => {
  const ungated = realRegistrations().filter((r) => !r.gated && !EXEMPT.has(r.key)).map((r) => r.key);
  assert.deepEqual(ungated, []);
});

test('every exemption still matches an ungated registration', () => {
  const ungated = new Set(realRegistrations().filter((r) => !r.gated).map((r) => r.key));
  const stale = [...EXEMPT.keys()].filter((key) => !ungated.has(key));
  assert.deepEqual(stale, []);
});

test('control: a known snippet yields exactly its ungated registrations', () => {
  const source = stripComments([
    "router.get('/a', authenticate, handler);",
    "router.post('/b', requireMachineIngestSecret, handler);",
    "router.post('/c', handler);",
    "router.put('/d', handler); // authenticate",
    'router.use(authenticate);',
    "router.delete('/e', handler);",
  ].join('\n'));

  const ungated = registrationsIn(source, `${__dirname}/snippet.js`).filter((r) => !r.gated).map((r) => r.key.split(' ').slice(1).join(' '));
  assert.deepEqual(ungated, ['POST /c', 'PUT /d']);

  // A guard that stops matching passes vacuously; floor the real tree.
  const count = realRegistrations().length;
  assert.ok(count >= 400, `expected 400+ route registrations, found ${count}`);
});
