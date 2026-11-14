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
// The rule: every route registration in the comment-stripped source of the
// two route directories, their subdirectories included, is GATED when its own
// argument list names one of the credential gates below, or an earlier
// router-wide .use( on the same router in the same file does. Otherwise it is
// named in EXEMPT with its reason. Exemptions are keyed by file + verb + path,
// never by line, so an unrelated edit cannot shift one out of date; an
// exemption that no longer matches anything fails too.
//
// #1553: two readings, and a registration is gated only when both say so.
// The first is #1552's: `router.<verb>(` and `router.use(` by exact text, with
// a gate named anywhere in the call's arguments. The second reads every name
// the file binds to a Router() call as well as `router`; lets whitespace and a
// line break sit around the dot; counts `.all(`, each verb of a
// `.route('/x')` chain and each verb chained on a registration; takes a gate
// only as a whole argument before the handler, so a gate named inside the
// handler does not count; and takes a `.use(` as router-wide only when its
// first argument is a gate, so `router.use('/admin', authenticate)` gates
// nothing. A file whose Router() calls are not each bound to a name, or whose
// chain continues with anything but a verb, fails as UNREADABLE.
//
// Known limits: a router reached through another binding (`const r = router`,
// a function parameter, an object property) or a computed member
// (`router[verb](`) is not read; a `.use(authenticate)` inside a condition
// still counts as router-wide; a gate passed inside an array of middleware is
// not read as a gate, so such a route reads as ungated. An optional-chained
// call (`router?.get(`), a verb outside get, post, put, patch, delete, head and
// all (`router.options(`), and a quote or regex literal holding an unbalanced
// bracket inside a registration's arguments are not read either; the last can
// stretch a call's arguments over the next registration's gate, so an ungated
// route reads as gated, as it did under #1552's reading. A registration only
// the first reading sees (`this.router.get(`) is listed as ungated.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { routeFiles, routeFilesIn, relative, argsAt } = require('./helpers/route-gate-sites');
const { readStripped, stripComments } = require('./helpers/strip-comments');

// The first reading (#1552). Same registration pattern as the helper's ROUTE_START.
const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/gi;
const ROUTER_USE = /\brouter\.use\s*\(/g;
const CREDENTIAL_GATE = /\b(authenticate|requireMachineIngestSecret|requireTestSupportSecret)\b/;

// The second reading (#1553).
const VERB = /^(get|post|put|patch|delete|head|all)$/i;
const ROUTER_CALL = /\bRouter\s*\(/g;
const ROUTER_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:require\s*\(\s*(['"])express\2\s*\)\s*\.\s*|express\s*\.\s*)?Router\s*\(/g;
const GATE_NAME = /^(?:authenticate|requireMachineIngestSecret|requireTestSupportSecret)$/;
const CHAINED_CALL = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/;

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

/** The first reading: each `router.<verb>(` by exact text, keyed by its opening parenthesis. */
function firstReading(content) {
  const uses = [...content.matchAll(ROUTER_USE)].map((m) => ({
    index: m.index,
    args: argsAt(content, m.index + m[0].length - 1) || '',
  }));
  return [...content.matchAll(ROUTE_START)].map((m) => {
    const open = m.index + m[0].indexOf('(');
    const args = argsAt(content, open) || '';
    const ownGate = CREDENTIAL_GATE.test(args);
    const routerGate = uses.some((use) => use.index < m.index && CREDENTIAL_GATE.test(use.args));
    return { open, method: m[1].toUpperCase(), routePath: m[3] === undefined ? null : m[3], gated: ownGate || routerGate };
  });
}

/** The top-level arguments of a call's argument text, trimmed. */
function topLevelArgs(args) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < args.length; i += 1) {
    const c = args[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '\'' || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

const literalPath = (arg) => {
  const m = /^(['"`])([^'"`]*)\1$/.exec(arg || '');
  return m ? m[2] : null;
};

// A gate counts only as a whole argument before the last one (the handler).
const middlewareGated = (args) => topLevelArgs(args).slice(0, -1).some((a) => GATE_NAME.test(a));

/** The second reading: every registration on every name bound to a Router() call. */
function secondReading(content) {
  const bindings = [...content.matchAll(ROUTER_BINDING)];
  const names = new Set(['router']);
  for (const b of bindings) names.add(b[1]);
  let unreadable = [...content.matchAll(ROUTER_CALL)].length !== bindings.length;
  const regs = [];

  // Follows `.verb(...)` links after a call closing at `pos`; each verb is a
  // registration, on routePath when given, else on its own first argument.
  const followChain = (pos, routePath, gatedByUse) => {
    for (;;) {
      const c = CHAINED_CALL.exec(content.slice(pos));
      if (!c) return;
      if (!VERB.test(c[1])) {
        unreadable = true;
        return;
      }
      const open = pos + c[0].length - 1;
      const args = argsAt(content, open);
      if (args === null) {
        unreadable = true;
        return;
      }
      regs.push({
        open,
        method: c[1].toUpperCase(),
        routePath: routePath === undefined ? literalPath(topLevelArgs(args)[0]) : routePath,
        gated: middlewareGated(args) || gatedByUse,
      });
      pos = open + args.length + 2;
    }
  };

  for (const name of names) {
    const n = name.replace(/\$/g, '\\$');
    const memberCall = new RegExp(`(?<![\\w$.])${n}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
    const calls = [...content.matchAll(memberCall)].map((m) => ({
      index: m.index,
      member: m[1],
      open: m.index + m[0].length - 1,
    }));
    const gateUses = calls
      .filter((c) => c.member === 'use' && GATE_NAME.test(topLevelArgs(argsAt(content, c.open) || '')[0]))
      .map((c) => c.index);
    const gatedAt = (index) => gateUses.some((u) => u < index);

    for (const call of calls) {
      const args = argsAt(content, call.open);
      if (args === null) continue;
      const after = call.open + args.length + 2;
      if (VERB.test(call.member)) {
        regs.push({
          open: call.open,
          method: call.member.toUpperCase(),
          routePath: literalPath(topLevelArgs(args)[0]),
          gated: middlewareGated(args) || gatedAt(call.index),
        });
        followChain(after, undefined, gatedAt(call.index));
      } else if (call.member === 'route') {
        followChain(after, literalPath(topLevelArgs(args)[0]), gatedAt(call.index));
      } else {
        // .use(...).get(...) and the like: the chained verbs are registrations too.
        followChain(after, undefined, gatedAt(call.index + 1));
      }
    }
  }
  return { regs, unreadable };
}

/** Every registration in one file's comment-stripped source; gated only when both readings say so. */
function registrationsIn(content, file) {
  const first = new Map(firstReading(content).map((r) => [r.open, r]));
  const { regs, unreadable } = secondReading(content);
  const byOpen = new Map(regs.map((r) => [r.open, r]));
  // A registration only the first reading sees (`this.router.`, `Router.`) is
  // kept but never gated: the second reading could not place its router.
  for (const [open, r] of first) if (!byOpen.has(open)) byOpen.set(open, { ...r, gated: false });
  const out = [...byOpen.values()].sort((a, b) => a.open - b.open).map((r) => ({
    key: `${relative(file)} ${r.method} ${r.routePath}`,
    gated: r.gated && (!first.has(r.open) || first.get(r.open).gated),
  }));
  if (unreadable) out.push({ key: `${relative(file)} UNREADABLE Router() binding or chain`, gated: false });
  return out;
}

function realRegistrations() {
  return routeFiles().flatMap((file) => registrationsIn(readStripped(fs, file), file));
}

/** The ungated keys of a snippet, less the file name. */
function ungatedIn(lines) {
  return registrationsIn(stripComments(lines.join('\n')), `${__dirname}/snippet.js`)
    .filter((r) => !r.gated)
    .map((r) => r.key.split(' ').slice(1).join(' '));
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
  assert.deepEqual(ungatedIn([
    "router.get('/a', authenticate, handler);",
    "router.post('/b', requireMachineIngestSecret, handler);",
    "router.post('/c', handler);",
    "router.put('/d', handler); // authenticate",
    'router.use(authenticate);',
    "router.delete('/e', handler);",
  ]), ['POST /c', 'PUT /d']);

  // A guard that stops matching passes vacuously; floor the real tree.
  const count = realRegistrations().length;
  assert.ok(count >= 400, `expected 400+ route registrations, found ${count}`);
});

test('control: a path-scoped use does not gate the routes after it', () => {
  assert.deepEqual(ungatedIn([
    "router.use('/admin', authenticate);",
    "router.post('/public', handler);",
  ]), ['POST /public']);
});

test('control: router.all is a registration', () => {
  assert.deepEqual(ungatedIn([
    "router.all('/any', handler);",
  ]), ['ALL /any']);
});

test('control: each verb of a route chain is a registration', () => {
  assert.deepEqual(ungatedIn([
    "router.route('/x').get(authenticate, handler).post(handler);",
  ]), ['POST /x']);
});

test('control: a verb chained on a registration is a registration', () => {
  assert.deepEqual(ungatedIn([
    "router.get('/a', authenticate, handler).post('/b', handler);",
  ]), ['POST /b']);
});

test('control: a verb that begins the next line is a registration', () => {
  assert.deepEqual(ungatedIn([
    'router',
    "  .post('/n', handler);",
  ]), ['POST /n']);
});

test('control: a router bound to another name is read', () => {
  assert.deepEqual(ungatedIn([
    'const api = express.Router();',
    "api.get('/other', handler);",
    "const { Router } = require('express');",
    'const second = Router();',
    "second.put('/p', handler);",
  ]), ['GET /other', 'PUT /p']);
});

test('control: a Router() call bound to no name fails the file', () => {
  assert.deepEqual(ungatedIn([
    "module.exports = express.Router().get('/m', handler);",
  ]), ['UNREADABLE Router() binding or chain']);
});

test('control: a gate named only inside the handler does not gate', () => {
  assert.deepEqual(ungatedIn([
    "router.get('/h', (req, res) => res.status(401).json({ error: 'authenticate' }));",
  ]), ['GET /h']);
});

test('control: a registration only the first reading sees is never gated', () => {
  assert.deepEqual(ungatedIn([
    "router.use('/admin', authenticate);",
    "this.router.post('/x', handler);",
    "self.router.post('/y', authenticate, handler);",
    "Router.get('/z', authenticate, handler);",
  ]), ['POST /x', 'POST /y', 'GET /z']);
});

test('control: a route file in a subdirectory is walked', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-walk-'));
  try {
    const planted = path.join(root, 'nested', 'planted.js');
    fs.mkdirSync(path.dirname(planted));
    fs.writeFileSync(planted, "router.post('/planted', handler);\n");
    assert.deepEqual(routeFilesIn([root]), [planted]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
