// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect. History: #1325.
//
// RNF006 C2 asks for the APIs to be documented. docs/api/openapi.json is that
// documentation for the mounts it lists in `x-covered-mounts`, and a spec
// written by hand drifts from the routes the moment a registration is added,
// renamed or removed. This guard keeps the two equal, in both directions:
//
//   - every operation the spec documents is a registration under its app.js
//     mount, so the spec never promises a route that 404s;
//   - every registration under a covered mount is in the spec, so a new
//     route on a documented mount cannot ship undocumented.
//
// It READS app.js and requires none of it. It requires the router factories
// below and the modules their mounts' option literals require, and since
// #1416 also each covered plain route file (and each KNOWN_SUBROUTERS router
// module) fresh, with express.Router swapped for the same recording stub the
// factories get and the test-support gate held open (NODE_ENV=test,
// ENABLE_TEST_SUPPORT_ROUTES=true) while it loads. Every covered plain route
// file loads; none is kept on the text reading alone. Each file's record and
// its text are compared, and a registration one reading has and the other
// lacks is refused, so one on a second handle, a computed or spaced member,
// or a variable path is seen. The three KNOWN_SUBROUTERS route files
// themselves (orphanet, hpo and dictionary .routes.js) are read by their exact
// text alone, and their router modules recorded. The mounts come from
// app.js's `app.use("<prefix>", require("<module>"))` calls; a limiter
// mounted on or below a covered prefix (`app.use("/api/auth", authLimiter)`)
// registers no route and is not a mount; each such name must be declared in
// app.js with `rateLimit(`. A prefix mounted more than once takes the union
// of its files' registrations. A parameterised prefix is compared in its
// `{x}` form, as x-covered-mounts and the spec paths write it, and a mount
// nested under a covered mount passes only when it is itself covered.
//
// A route file KNOWN_SUBROUTERS names may hand all its routes to one router
// module, and that module's registrations are then read at the route file's
// own mount, since router.use with no path mounts there. Two texts are read
// as that hand-off, and nothing else: the whole file, whitespace collapsed,
// is `const router = require('<module>'); module.exports = router;` (with
// an optional `const express = require('express');` first); or the whole
// file, whitespace collapsed, is exactly the one the map records: its require
// lines, `const router = express.Router();`, one router.use(...) with the
// recorded arguments, the module's binding last, and `module.exports =
// router;`. In either text every require is also a call with one string
// literal, exactly one of them resolves to the module by any spelling, and
// module.exports is named once. The module must itself be a plain route
// file, with no refusal of its own, no import(, createRequire, module[,
// defineProperty(module, module.constructor, module.parent or mainModule,
// and module named only in its one module.exports = router; (a `module`
// that is an object key, as in { req, module: 'x' }, is not counted), so a
// module that hands off again is refused. This fails closed: a file not in
// the map, or one in it whose text is not exactly a modeled shape, gets the
// refusals below unchanged, and the reading removes no refusal but the one
// for that router.use argument.
//
// A route file KNOWN_HANDOFFS names hands all its routes to one router module
// too, but with code of its own (helpers, middleware) around the hand-off, so
// no exact text models it. Two readings must both hold. Its text must require
// that module exactly once, by any spelling, bound once as const <name> =
// require('<module>');, make no request but a relative one (./ or ../) or one
// of the bare requests its entry lists, with no backslash in any, name <name>
// only there and as the last argument of its one router.use(, name router
// only in its declaration, that call and its export, name module.exports
// once, as module.exports = router;, name module nowhere else, name neither
// arguments nor getBuiltinModule, globalThis, global, eval or Function(, and
// hold none of the handles listed for a router module above. And it is loaded, as a plain route file is, with the router
// module's require.cache entry swapped for a sentinel: the sentinel must be
// handed to router.use( exactly once, as its last argument, and any other
// touch of it (a property read or write, a call, `in`, a prototype read) is
// refused; the file's own registrations are recorded and compared with its
// text, and both cache entries are put back after. A file whose text fails
// the first reading keeps every refusal, and the router module gets the
// router module refusals above. This fails closed the same way.
//
// The second claim holds only because the guard fails closed: a shape that
// could add a route under a covered mount but that the extraction does not
// read (a router.route() chain, router.all, a sub-router, a second router,
// a non-literal or middleware-prefixed mount, a mount below a covered
// prefix, an uncovered mount above a covered prefix, a route registered on
// app itself) is refused with its file and line, rather than passed as if it
// registered nothing.
//
// A mount written app.use("<prefix>", <factory>({ ... })) is read too, for a
// factory named in KNOWN_FACTORIES, and it is the one place the guard runs
// code: a factory's routes can differ per mount, which no reading of its
// text settles. In app.js the second argument must be that one call with one
// object literal and nothing after it, and app.js must bind the factory
// once, as const <factory> = require("<module>"). Each such mount is then
// recorded: the guard requires the factory module, evaluates the mount's
// object literal, and calls the factory with express.Router swapped for a
// stub that records each registration's method and path. The record fails
// closed: exactly one router built through express.Router() and returned, a
// string path on every registration, no path in router.use and none of its
// arguments the record's router, a function with an array `stack` (a router)
// or one with `handle` and `set` (an express app), and any other use of the
// router (route, all, options, ...) or a throw is refused. The factory
// module's text is read as well, as any route file is, and every literal
// registration in it must be in the record, so one on a branch this mount's
// options skip, or one run later inside a handler, is refused; so is any use
// of `router` other than router.<method>(, its declaration and `return
// router;`, since an alias or a hand-off could register out of both
// readings' sight, a call on the router that anything chains onto, and a
// router.use( argument other than a bare identifier or a call of one, since
// an arrow or a bound handle can hide a router. The text must also hold each
// registration as a statement of the factory's body, outside any block,
// inner function or template literal, with no return of the factory's own
// before its last registration, one `return router;`, and the factory
// exported as module.exports = <factory>; so what one mount's options skip
// is refused even where the record cannot see it.
//
// An uncovered mount whose prefix is a strict ancestor of a covered entry,
// segment by segment with a {param} matching any segment, may register
// routes that also match the covered entry's paths, so it is refused unless
// KNOWN_ANCESTORS names it with every covered entry below it. The one named
// exception: app.js mounts /api/biobanks through createMasterDataRouter,
// whose /:id routes also match /api/biobanks/miabis and are not documented.
// An uncovered mount whose prefix holds a path pattern (?, *, + or
// parentheses) is refused outright, since it cannot be compared segment by
// segment.
//
// These gaps remain. Prefixes are compared case-sensitively, while Express
// matches paths case-insensitively by default, so app.use("/API/export")
// is not seen as above /api/export/fhir. And a route registered on app
// itself (app.get, app.all, ...) is refused only when its literal path is
// under a covered prefix; a pattern such as app.get("/api/*") that also
// matches covered paths is not checked. A factory's registration built from
// a string at run time (eval, new Function) inside a handler is in neither
// reading, and neither is a router hidden by router.use(<name>(...)) where
// that call returns a plain function wrapping the router. And a module other
// than its route file that requires a router module a KNOWN_SUBROUTERS file
// or a KNOWN_HANDOFFS file hands off to, and registers on it, is in neither
// reading. Nor, in a plain route file or a KNOWN_HANDOFFS file, is a
// registration the text cannot read (a second handle, a computed or spaced
// member, a variable path) that runs only later, inside a handler, or on a
// branch the load skips (one gated on an environment value other than the
// test-support gate). And a registration skipped while the
// test-support gate is open, or one made only by a file that detects the
// stub, is in neither reading.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { readStripped } = require('./helpers/strip-comments');

const backendRoot = path.resolve(__dirname, '..', '..');
const APP_JS = path.join(backendRoot, 'app.js');
const SPEC = path.resolve(backendRoot, '..', '..', 'docs', 'api', 'openapi.json');

const MOUNT = /\bapp\.use\(\s*(['"])([^'"]+)\1\s*,\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*\)/g;
// The shape of route-gate-sites.js's ROUTE_START, copied: the helper does not
// export it. Multi-line safe, and a registration with no literal path still
// matches, with group 3 undefined.
const ROUTE_START = /\brouter\.(get|post|put|patch|delete|head)\s*\(\s*(?:(['"`])([^'"`]*)\2)?/gi;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

// Middleware app.js mounts on or below a covered prefix that registers no
// route. Each name is declared in app.js as `const <name> = rateLimit(`.
const KNOWN_LIMITERS = new Set(['authLimiter', 'consentLimiter']);
// Uncovered mounts above a covered prefix, each with the covered prefixes
// below it that it is known to overlap. The master-data router mounted at
// /api/biobanks has /:id routes that also match /api/biobanks/miabis (GET,
// PUT and DELETE with id `miabis`); they are not documented.
const KNOWN_ANCESTORS = new Map([['/api/biobanks', ['/api/biobanks/miabis']]]);
// Router factories app.js mounts as app.use("<prefix>", <name>({ ... })), each
// with the module app.js must declare it from, as const <name> = require("<module>").
const KNOWN_FACTORIES = new Map([['createMasterDataRouter', './src/interface/routes/master-data.routes']]);
// Route files, relative to backendRoot, that hand every route to one router
// module: the exact require() string of that module, and, for a file that is
// not a bare re-export (use: null), its require lines in order and the whole
// argument list of its one router.use( call, the module's binding last.
const KNOWN_SUBROUTERS = new Map([
  ['src/interface/routes/orphanet.routes.js', { request: '../../routes/orphanet', use: null }],
  ['src/interface/routes/hpo.routes.js', { request: '../../routes/hpo', use: null }],
  ['src/interface/routes/dictionary.routes.js', {
    request: '../../../src/routes/dictionary',
    requires: [
      "const express = require('express');",
      "const { authenticate } = require('../../infrastructure/middleware/auth');",
      "const dictionaryRouter = require('../../../src/routes/dictionary');",
    ],
    use: 'authenticate, dictionaryRouter',
  }],
]);
// Route files, relative to backendRoot, that hand every route to one router
// module through one router.use( whose last argument is that module's
// binding, with code of their own (helpers, middleware) around it: the exact
// require() string of that module (request), and the exact bare requests the
// file may make besides its relative ones (bare). Read by handoffOf and
// recorded at load by handoffRecord.
const KNOWN_HANDOFFS = new Map([
  ['src/interface/routes/intakeWizard.routes.js', {
    request: '../../../src/routes/intakeWizard',
    bare: ['crypto', 'express', 'mongodb'],
  }],
]);

const APP_CALL = /\bapp\.(use|get|post|put|patch|delete|all|options|head|route)\s*\(/g;
const ROUTER_PATH_SHAPE = /\brouter\.(route|all|options|use)\s*\(\s*['"`]/g;
const ROUTER_USE = /\brouter\.use\s*\(/g;
const ROUTER_DECLARATION = /\b(?:const|let|var)\s+router\s*=\s*express\.Router\s*\(/;
const ANY_ROUTER = /\bRouter\s*\(/g;
const OTHER_RECEIVER = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|head|all|options|route|use)\s*\(\s*['"`]\//g;

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// The top-level arguments of the call whose `(` is at `open`, as source text.
function callArgs(source, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      if (depth === 0) {
        args.push(source.slice(start, i).trim());
        break;
      }
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args.filter((arg) => arg !== '');
}

function literalOf(arg) {
  const quoted = /^(['"])([^'"]*)\1$/.exec(arg);
  if (quoted) return quoted[2];
  const template = /^`([^`$]*)`$/.exec(arg);
  return template ? template[1] : null;
}

const isUnder = (route, prefix) => route === prefix || route.startsWith(`${prefix}/`);

// The index of the bracket closing the one at `open`, skipping strings; -1 if none.
function closeOf(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Bracket depth at `index`, counted from `from`, skipping strings.
function depthAt(source, from, index) {
  let depth = 0;
  for (let i = from; i < index; i += 1) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
    } else if ('([{'.includes(c)) {
      depth += 1;
    } else if (')]}'.includes(c)) {
      depth -= 1;
    }
  }
  return depth;
}

// The index past the template literal whose backtick is at `open`, its
// ${...} substitutions and any literal nested in them included; the source
// length when it never closes.
function templateEnd(source, open) {
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
    } else if (source[i] === '`') {
      return i + 1;
    } else if (source[i] === '$' && source[i + 1] === '{') {
      let depth = 0;
      for (i += 1; i < source.length; i += 1) {
        const c = source[i];
        if (c === '`') {
          i = templateEnd(source, i) - 1;
        } else if (c === '"' || c === "'") {
          for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
        } else if (c === '{') {
          depth += 1;
        } else if (c === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
    }
  }
  return source.length;
}

// The [start, end) spans of `source`'s string and template literals, each
// template whole, with whether it is one.
function literalSpans(source) {
  const spans = [];
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '`') {
      const end = templateEnd(source, i);
      spans.push({ start: i, end, template: true });
      i = end - 1;
    } else if (c === '"' || c === "'") {
      const start = i;
      for (i += 1; i < source.length && source[i] !== c; i += 1) if (source[i] === '\\') i += 1;
      spans.push({ start, end: i + 1, template: false });
    }
  }
  return spans;
}

// Whether `index` lies in a function nested in the body whose `{` is at
// `bodyOpen`: some brace enclosing it opens an arrow (=> {) or a function
// (function [name](...) {). Any other brace is a block of the body itself.
function inInnerFunction(source, spans, bodyOpen, index) {
  const stack = [];
  const parenOpen = new Map();
  let span = 0;
  for (let i = bodyOpen + 1; i < index; i += 1) {
    while (span < spans.length && spans[span].end <= i) span += 1;
    if (span < spans.length && spans[span].start <= i) {
      i = spans[span].end - 1;
      continue;
    }
    const c = source[i];
    if ('([{'.includes(c)) stack.push(i);
    else if (')]}'.includes(c)) parenOpen.set(i, stack.pop());
  }
  return stack.some((open) => {
    if (source[open] !== '{') return false;
    const head = source.slice(bodyOpen, open).trimEnd();
    if (head.endsWith('=>')) return true;
    if (!head.endsWith(')')) return false;
    const paren = parenOpen.get(bodyOpen + head.length - 1);
    return paren !== undefined && /\bfunction\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*$/.test(source.slice(bodyOpen, paren));
  });
}

// A factory module whose routes could differ per mount: a registration
// outside the factory's body or nested in a block, call, inner function or
// template literal inside it, a return of the factory's own before its last
// registration, no module.exports of the factory, or no return of its router.
function factoryFileRefusals(source, label, name) {
  const refusals = [];
  const decl = [...source.matchAll(new RegExp(`\\bfunction\\s+${name.replace(/[$]/g, '\\$&')}\\s*\\(`, 'g'))];
  if (decl.length !== 1) return [`${label}: expected exactly one function ${name}(; found ${decl.length}`];
  const paramsClose = closeOf(source, decl[0].index + decl[0][0].length - 1);
  const bodyOpen = paramsClose < 0 ? -1 : source.indexOf('{', paramsClose);
  const bodyClose = bodyOpen < 0 ? -1 : closeOf(source, bodyOpen);
  if (bodyClose < 0 || source.slice(paramsClose + 1, bodyOpen).trim() !== '') {
    return [`${label}: cannot find the body of function ${name}`];
  }
  for (const match of source.matchAll(ROUTE_START)) {
    // A statement starts the body or follows a `;`, `{` or `}`: a registration
    // after `)` (a brace-less if, for or while), `?`, `&`, `|`, `,`, `>` or a
    // word (do, else) is conditional or repeated, though it sits at depth 1.
    const before = match.index < bodyOpen ? '' : source.slice(bodyOpen + 1, match.index).trimEnd().slice(-1);
    if (match.index < bodyOpen || match.index > bodyClose || depthAt(source, bodyOpen, match.index) !== 1 || !['', ';', '{', '}'].includes(before)) {
      refusals.push(`${label}:${lineOf(source, match.index)} router.${match[1]}( is not a statement of ${name}'s body, so a mount may not register it`);
    }
  }
  // A template literal is opaque: a registration in one, ${...} included, is
  // refused, never read at the depth of the code around it. A return of the
  // factory's own, at any block depth, before its last registration leaves
  // that registration to one branch.
  const spans = literalSpans(source);
  const registrations = [...source.matchAll(/\brouter\s*\.\s*(get|post|put|patch|delete|head|use)\s*\(/gi)];
  for (const match of registrations) {
    if (spans.some((s) => s.template && s.start < match.index && match.index < s.end)) {
      refusals.push(`${label}:${lineOf(source, match.index)} router.${match[1]}( sits inside a template literal, so a mount may not register it`);
    }
  }
  const lastRegistration = Math.max(-1, ...registrations.map((m) => m.index).filter((i) => i > bodyOpen && i < bodyClose));
  for (const match of source.slice(0, lastRegistration).matchAll(/\breturn\b/g)) {
    if (match.index <= bodyOpen || spans.some((s) => s.start <= match.index && match.index < s.end)) continue;
    if (!inInnerFunction(source, spans, bodyOpen, match.index)) {
      refusals.push(`${label}:${lineOf(source, match.index)} ${name} returns before its last registration, so a mount may not register what follows`);
    }
  }
  const body = source.slice(bodyOpen, bodyClose);
  const returns = [...body.matchAll(/\breturn\b\s*([^;]*);/g)].filter((m) => depthAt(body, 0, m.index) === 1);
  if (returns.length !== 1 || returns[0][1].trim() !== 'router') refusals.push(`${label}: ${name} must end in its one return router;`);
  if (!new RegExp(`\\bmodule\\.exports\\s*=\\s*${name.replace(/[$]/g, '\\$&')}\\s*;`).test(source)) {
    refusals.push(`${label}: does not export ${name} as module.exports = ${name};`);
  }
  return refusals;
}

// The KNOWN_FACTORIES name a mount argument calls, when the argument is
// exactly <name>({ ... }): one call, one object literal, nothing after it.
function factoryCall(arg) {
  const head = /^([A-Za-z_$][\w$]*)\s*\(/.exec(arg);
  if (!head || !KNOWN_FACTORIES.has(head[1])) return null;
  const open = head[0].length - 1;
  if (closeOf(arg, open) !== arg.length - 1) return null;
  const inner = callArgs(arg, open);
  return inner.length === 1 && inner[0].startsWith('{') && closeOf(inner[0], 0) === inner[0].length - 1 ? head[1] : null;
}

// Whether app.js binds `name` once, as const <name> = require("<its module>").
function factoryDeclared(source, name) {
  const escaped = name.replace(/[$]/g, '\\$&');
  const module = KNOWN_FACTORIES.get(name).replace(/[.]/g, '\\.');
  const bindings = [...source.matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*=(?![=>])`, 'g'))];
  return bindings.length === 1 &&
    new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*require\\(\\s*(['"])${module}\\1\\s*\\)`).test(source);
}

const templated = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const isParam = (segment) => /^\{[^}]+\}$/.test(segment);
// Whether `prefix` is a strict ancestor of `covered`, segment by segment, a
// {param} on either side matching any segment.
function isAbove(prefix, covered) {
  const upper = prefix.replace(/\/$/, '').split('/');
  const lower = covered.split('/');
  return upper.length < lower.length &&
    upper.every((segment, i) => segment === lower[i] || isParam(segment) || isParam(lower[i]));
}

// app.js calls the mount extraction cannot vouch for under a covered prefix.
function appRefusals(source, label, covered) {
  const refusals = [];
  for (const match of source.matchAll(APP_CALL)) {
    const method = match[1];
    const args = callArgs(source, match.index + match[0].length - 1);
    const at = `${label}:${lineOf(source, match.index)} app.${method}(`;
    const literal = literalOf(args[0] || '');
    if (literal === null) {
      if (args.length > 1) refusals.push(`${at}: its prefix is not a string literal, so it may fall under a covered mount`);
      continue;
    }
    const prefix = templated(literal);
    const mount = covered.filter((p) => isUnder(prefix, p)).sort((a, b) => b.length - a.length)[0];
    if (!mount) {
      if (method !== 'use' || (args.length === 2 && KNOWN_LIMITERS.has(args[1]))) continue;
      if (/[?*()+]/.test(prefix)) {
        refusals.push(`${at}"${prefix}": a mount pattern (?, *, + or parentheses) the guard cannot compare with the covered prefixes; write it as plain segments`);
        continue;
      }
      const known = KNOWN_ANCESTORS.get(prefix) || [];
      for (const c of covered.filter((p) => isAbove(prefix, p) && !known.includes(p))) {
        refusals.push(`${at}"${prefix}": an uncovered mount above the covered ${c}; its routes may match ${c}'s paths; cover it or name it in KNOWN_ANCESTORS`);
      }
      continue;
    }
    if (method !== 'use') {
      refusals.push(`${at}"${prefix}": a route registered on app itself under ${mount}`);
    } else if (prefix !== mount) {
      // A known limiter registers no route, so it may sit below a covered mount.
      if (args.length === 2 && KNOWN_LIMITERS.has(args[1])) continue;
      refusals.push(`${at}"${prefix}": a mount below the covered ${mount}; cover the mount itself or move the routes`);
    } else if (!(args.length === 2 && (/^require\(\s*(['"])[^'"]+\1\s*\)$/.test(args[1]) || KNOWN_LIMITERS.has(args[1])))) {
      const factory = args.length === 2 ? factoryCall(args[1]) : null;
      if (!factory) {
        refusals.push(`${at}"${prefix}", ...): neither app.use(prefix, require(module)), a known limiter, nor a known factory called with one object literal`);
      } else if (!factoryDeclared(source, factory)) {
        refusals.push(`${at}"${prefix}", ${factory}(...)): app.js does not bind ${factory} once, as const ${factory} = require("${KNOWN_FACTORIES.get(factory)}")`);
      }
    }
  }
  return refusals;
}

// Shapes in a covered route file that could register a route the
// ROUTE_START extraction does not read. A `delegation` from delegationOf
// lifts the refusal of its own router.use argument only, or, for a bare
// re-export, every refusal, since the whole text is the modeled one.
function routeFileRefusals(source, label, delegation = null) {
  if (delegation && delegation.kind === 'reexport') return [];
  const refusals = [];
  const at = (index) => `${label}:${lineOf(source, index)}`;
  for (const match of source.matchAll(ROUTE_START)) {
    if (match[3] === undefined) refusals.push(`${at(match.index)} router.${match[1]}( has no literal path`);
  }
  for (const match of source.matchAll(ROUTER_PATH_SHAPE)) {
    refusals.push(`${at(match.index)} router.${match[1]}('<path>' is a shape the extraction does not read`);
  }
  for (const match of source.matchAll(ROUTER_USE)) {
    for (const arg of callArgs(source, match.index + match[0].length - 1)) {
      const required = arg.includes('require(') || (/^[A-Za-z_$][\w$]*$/.test(arg) &&
        new RegExp(`\\b(?:const|let|var)\\s+${arg.replace(/[$]/g, '\\$&')}\\s*=\\s*require\\s*\\(`).test(source));
      const delegated = delegation && match.index === delegation.index && arg === delegation.name;
      if (required && !delegated) refusals.push(`${at(match.index)} router.use(${arg}) mounts a required module, maybe a sub-router`);
    }
  }
  const routers = [...source.matchAll(ANY_ROUTER)];
  if (routers.length !== 1 || !ROUTER_DECLARATION.test(source)) {
    refusals.push(`${label}: expected exactly one Router(), as const router = express.Router(); found ${routers.length}`);
  }
  for (const match of source.matchAll(OTHER_RECEIVER)) {
    if (match[1] !== 'router') refusals.push(`${at(match.index)} ${match[1]}.${match[2]}('/...' registers on a receiver other than router`);
  }
  return refusals;
}

const EXPORTS_ROUTER = /\bmodule\.exports\s*=\s*router\s*;/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const relOf = (file) => path.relative(backendRoot, file).split(path.sep).join('/');
// Whether `source` names module.exports once, as module.exports = router;, so
// no later assignment swaps in a router nothing reads.
const exportsOnlyRouter = (source) => [...source.matchAll(/\bmodule\s*\.\s*exports\b/g)].length === 1 && EXPORTS_ROUTER.test(source);

// Whether every require in `source`, the text of the route file `rel`, is a
// call with one string literal, and exactly one of them resolves, from that
// file's directory, to the module `request` names, by whatever spelling
// (./x, ./x.js, ../dir/x), so no second handle can register on it.
function requiresModuleOnce(source, rel, request) {
  const dir = path.dirname(path.join(backendRoot, rel));
  const moduleOf = (text) => path.resolve(dir, text).replace(/\.js$/, '').replace(/[\\/]index$/, '');
  const target = moduleOf(request);
  let count = 0;
  for (const match of source.matchAll(/\brequire\b(\s*\()?/g)) {
    if (!match[1]) return false;
    const args = callArgs(source, match.index + match[0].length - 1);
    const literal = args.length === 1 ? literalOf(args[0]) : null;
    if (literal === null) return false;
    if (moduleOf(literal) === target) count += 1;
  }
  return count === 1;
}

// The hand-off of the route file `rel` (relative to backendRoot) to the one
// router module KNOWN_SUBROUTERS names for it, read from its stripped text:
// a bare re-export, or exactly the file the entry records, whitespace
// collapsed: its require lines, the router, its one router.use(...) and the
// export. Null for any other text.
function delegationOf(source, rel) {
  const entry = KNOWN_SUBROUTERS.get(rel);
  if (!entry) return null;
  if (!requiresModuleOnce(source, rel, entry.request) || !exportsOnlyRouter(source)) return null;
  const request = escapeRegExp(entry.request);
  const collapsed = source.replace(/\s+/g, ' ').trim();
  const reexport = new RegExp(`^(?:const express = require\\((['"])express\\1\\); )?const router = require\\((['"])${request}\\2\\); module\\.exports = router;$`);
  if (reexport.test(collapsed)) return { kind: 'reexport', request: entry.request };
  if (entry.use === null) return null;
  const template = [...entry.requires, 'const router = express.Router();', `router.use(${entry.use});`, 'module.exports = router;'].join(' ');
  if (collapsed !== template) return null;
  const uses = [...source.matchAll(ROUTER_USE)];
  return { kind: 'use', request: entry.request, name: entry.use.split(', ').pop(), index: uses[0].index };
}

// The `module` tokens of `source` other than an object key or a label: one
// right after { or , and right before a single :, as in { req, module: 'x' }.
const moduleReferences = (source) => [...source.matchAll(/(?<![\w$.])module(?![\w$])/g)]
  .filter((m) => !(/[{,]\s*$/.test(source.slice(0, m.index)) && /^module\s*:(?!:)/.test(source.slice(m.index)))).length;

// Ways a module can reach a router or module.exports other than through its
// own `router` and `module.exports = router;`.
const TARGET_HANDLES = /\bimport\s*\(|\bcreateRequire\b|\bmodule\s*\[|\bdefineProperty\s*\(\s*module\b|\bmodule\s*\.\s*constructor\b|\bmodule\s*\.\s*parent\b|\bmainModule\b/g;
// Further ways a KNOWN_HANDOFFS file could reach its sub-router or the module
// cache past both readings: the module wrapper's own arguments (require,
// module), a builtin module by process.getBuiltinModule, the global object,
// and code built at run time.
const NAMES_ARGUMENTS = /(?<![\w$])arguments(?![\w$])/;
const RUNTIME_HANDLES = /(?<![\w$])(?:getBuiltinModule|globalThis|global|eval)(?![\w$])|(?<![\w$])Function\s*\(/;

// A router module a route file hands off to must be a plain route file: no
// refusal of its own (so one that hands off again is refused), none of
// TARGET_HANDLES, and `module` named only in its one export, as
// module.exports = router;.
function delegateRefusals(source, label) {
  const refusals = [...routeFileRefusals(source, label)];
  if (!exportsOnlyRouter(source)) refusals.push(`${label}: does not export its router once, as module.exports = router;`);
  for (const match of source.matchAll(TARGET_HANDLES)) {
    refusals.push(`${label}:${lineOf(source, match.index)} ${match[0]} may reach a router or the export out of the reading's sight`);
  }
  if (moduleReferences(source) !== 1) {
    refusals.push(`${label}: names module other than in its one module.exports = router;`);
  }
  return refusals;
}

// The string literal of each require( call in `source`, read once
// requiresModuleOnce has held (so each is a call with one string literal).
const requestsOf = (source) => [...source.matchAll(/\brequire\b\s*\(/g)]
  .map((match) => literalOf(callArgs(source, match.index + match[0].length - 1)[0]));
// Whether the require request `request` of a KNOWN_HANDOFFS file is one of
// its entry's bare requests, exactly, or relative (./ or ../).
const allowedRequest = (request, entry) => entry.bare.includes(request) || /^\.\.?\//.test(request);

// The hand-off of the route file `rel` to the router module KNOWN_HANDOFFS
// names for it, read from its stripped text, or null. It holds only when
// every require is a call with one string literal and exactly one resolves to
// that module; every request is one of the entry's bare requests, exactly, or
// starts ./ or ../, and none holds a backslash (an escape that spells the
// module another way); the module is bound once as
// const <name> = require('<request>');;
// <name> is named exactly twice (that binding and the last argument of the
// file's one router.use( call); module.exports is named once, as
// module.exports = router;; module is named nowhere else; router is named
// only in const router = express.Router();, that router.use( and the export,
// so router.use cannot be swapped and no alias of it hands the sub-router on;
// neither `arguments` (the module wrapper's require and module) nor any of
// RUNTIME_HANDLES (a builtin module, the global object or code built at run
// time) appears; and none of TARGET_HANDLES appears. Any other text is null,
// and the router.use refusal stays.
function handoffOf(source, rel) {
  const entry = KNOWN_HANDOFFS.get(rel);
  if (!entry) return null;
  const { request } = entry;
  if (!requiresModuleOnce(source, rel, request) || !exportsOnlyRouter(source)) return null;
  const requests = requestsOf(source);
  if (requests.some((text) => text.includes('\\'))) return null;
  if (!requests.every((request) => allowedRequest(request, entry))) return null;
  if ([...source.matchAll(TARGET_HANDLES)].length !== 0 || moduleReferences(source) !== 1) return null;
  if (NAMES_ARGUMENTS.test(source)) return null;
  if (RUNTIME_HANDLES.test(source)) return null;
  const routerTokens = [...source.matchAll(/(?<![\w$.])router(?![\w$])/g)].length;
  if (routerTokens !== 3) return null;
  if (!ROUTER_DECLARATION.test(source)) return null;
  const binding = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*(['"])${escapeRegExp(request)}\\2\\s*\\)\\s*;`).exec(source);
  if (!binding) return null;
  const name = binding[1];
  if ([...source.matchAll(new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`, 'g'))].length !== 2) return null;
  const uses = [...source.matchAll(ROUTER_USE)];
  if (uses.length !== 1) return null;
  const args = callArgs(source, uses[0].index + uses[0][0].length - 1);
  if (args[args.length - 1] !== name) return null;
  return { kind: 'handoff', request, name, index: uses[0].index };
}

// The file the request of a hand-off from `file` names, or undefined.
function handoffTarget(file, request) {
  const base = path.resolve(path.dirname(file), request);
  return [base, `${base}.js`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

// The mounted files plus the router module each hand-off names, read at the
// same prefix, and the refusals of those modules.
function expandFiles(files) {
  const expanded = [...files];
  const refusals = [];
  for (const file of files) {
    const source = readStripped(fs, file);
    const delegation = delegationOf(source, relOf(file)) || handoffOf(source, relOf(file));
    if (!delegation) continue;
    const target = handoffTarget(file, delegation.request);
    if (!target) {
      refusals.push(`${relOf(file)}: ${delegation.request} does not resolve`);
      continue;
    }
    expanded.push(target);
    refusals.push(...delegateRefusals(readStripped(fs, target), relOf(target)));
  }
  return { files: expanded, refusals };
}

function resolveModule(request) {
  const base = path.resolve(backendRoot, request);
  return [base, `${base}.js`, path.join(base, 'index.js')].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
}

function collectMounts() {
  const mounts = new Map();
  const source = readStripped(fs, APP_JS);
  for (const match of source.matchAll(MOUNT)) {
    const prefix = templated(match[2]);
    const file = resolveModule(match[4]);
    if (!mounts.has(prefix)) mounts.set(prefix, new Set());
    if (file) mounts.get(prefix).add(file);
  }
  return mounts;
}

// app.use("<prefix>", <factory>({ ... })) for a known factory app.js binds
// once: prefix -> [{ name, options (the object literal's text), line }].
function collectFactoryMounts(source) {
  const mounts = new Map();
  for (const match of source.matchAll(APP_CALL)) {
    if (match[1] !== 'use') continue;
    const args = callArgs(source, match.index + match[0].length - 1);
    const literal = literalOf(args[0] || '');
    const name = args.length === 2 ? factoryCall(args[1]) : null;
    if (literal === null || !name || !factoryDeclared(source, name)) continue;
    const prefix = templated(literal);
    if (!mounts.has(prefix)) mounts.set(prefix, []);
    mounts.get(prefix).push({ name, options: callArgs(args[1], args[1].indexOf('('))[0], line: lineOf(source, match.index) });
  }
  return mounts;
}

const REGISTERS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head']);

// In a factory module, each `router` token other than router.<method>( with
// a method the record reads, its declaration `const router = express.Router()`
// or `return router;`: an alias, a computed or split member access, or the
// router handed to other code, any of which may register out of the
// record's and the text's sight.
function oddRouterUses(source, label) {
  const refusals = [];
  for (const match of source.matchAll(/\brouter\b/g)) {
    const after = source.slice(match.index);
    const before = source.slice(0, match.index);
    if (/^router\.(?:get|post|put|patch|delete|head|use)\s*\(/.test(after)) continue;
    if (/\b(?:const|let|var)\s+$/.test(before) && /^router\s*=\s*express\.Router\s*\(\s*\)/.test(after)) continue;
    if (/\breturn\s+$/.test(before) && /^router\s*;/.test(after)) continue;
    refusals.push(`${label}:${lineOf(source, match.index)} router is used other than as router.<method>(, its declaration or return router;`);
  }
  return refusals;
}

// In a factory module, a call on the router that another call or member
// access chains onto (router.use(a).get('/x', h)), which neither the text
// nor, on a branch or in a handler, the record reads; and a router.use(
// argument other than a bare identifier or a call of one (authenticate,
// requireRole(3, 4)), since an arrow or a bound handle can hide a router.
function routerCallRefusals(source, label) {
  const refusals = [];
  for (const match of source.matchAll(/\brouter\.(get|post|put|patch|delete|head|options|all|use)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const close = closeOf(source, open);
    if (close < 0 || /^\s*[.[]/.test(source.slice(close + 1))) {
      refusals.push(`${label}:${lineOf(source, match.index)} router.${match[1]}( is chained on, so what the chain registers is not read`);
    }
    if (match[1] !== 'use') continue;
    for (const arg of callArgs(source, open)) {
      const call = /^[A-Za-z_$][\w$]*\s*\(/.exec(arg);
      if (/^[A-Za-z_$][\w$]*$/.test(arg) || (call && closeOf(arg, call[0].length - 1) === arg.length - 1)) continue;
      refusals.push(`${label}:${lineOf(source, match.index)} router.use(${arg}) takes neither an identifier nor a call of one, so it may hide a router`);
    }
  }
  return refusals;
}

// Calls `factory(options)` with `expressModule.Router` swapped for a stub that
// records each registration as `METHOD <path>`. It fails closed: the factory
// must build exactly one router through expressModule.Router() and return
// that router; every registration takes a string path; router.use takes no
// path and no router; any other property of the router (route, all, options,
// param, stack, ...) is refused, as is a throw.
function recordFactory(factory, options, expressModule, label) {
  return recordRouter(() => factory(options), expressModule, label, 'the factory', 'return');
}

// The shared stub record behind recordFactory and recordRouteFile: `run`
// builds the router and gives back what should be it (a factory's return, a
// route file's module.exports); `subject` and `gives` word the refusals.
function recordRouter(run, expressModule, label, subject, gives, handoff = null) {
  const operations = [];
  const refusals = [];
  let stub = null;
  let built = 0;
  const handler = {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (REGISTERS.has(prop)) {
        return (...args) => {
          if (typeof args[0] === 'string') operations.push({ method: prop.toUpperCase(), path: args[0] });
          else refusals.push(`${label}: router.${prop}( with a path that is not a string`);
          return stub;
        };
      }
      if (prop === 'use') {
        return (...args) => {
          if (typeof args[0] !== 'function') refusals.push(`${label}: router.use( with a path`);
          for (const [i, arg] of args.entries()) {
            if (handoff && arg === handoff.sentinel) {
              handoff.uses += 1;
              if (i !== args.length - 1) refusals.push(`${label}: router.use( takes the sub-router other than as its last argument`);
              continue;
            }
            if (arg === stub || (typeof arg === 'function' && Array.isArray(arg.stack))) refusals.push(`${label}: router.use( of a router`);
            if (typeof arg === 'function' && typeof arg.handle === 'function' && typeof arg.set === 'function') refusals.push(`${label}: router.use( of an express app`);
          }
          return stub;
        };
      }
      refusals.push(`${label}: touches router.${prop}, a shape the record does not read`);
      return undefined;
    },
  };
  // A hand-off file may not write the router: a swapped router.use could
  // register on the sub-router it is handed, out of the record's sight.
  if (handoff) {
    const refuseWrite = (what) => (_target, prop) => {
      refusals.push(`${label}: ${what} router.${String(prop)}, a shape the record does not read`);
      return true;
    };
    Object.assign(handler, { set: refuseWrite('sets'), defineProperty: refuseWrite('defines'), deleteProperty: refuseWrite('deletes') });
  }
  const realRouter = expressModule.Router;
  expressModule.Router = () => {
    built += 1;
    stub = new Proxy(function router() {}, handler);
    return stub;
  };
  let returned;
  try {
    returned = run();
  } catch (error) {
    refusals.push(`${label}: ${subject} threw ${error && error.message}`);
  } finally {
    expressModule.Router = realRouter;
  }
  if (built !== 1) refusals.push(`${label}: ${subject} built ${built} routers through express.Router(); expected exactly 1`);
  else if (returned !== stub) refusals.push(`${label}: ${subject} did not ${gives} the router it built`);
  if (handoff && handoff.uses !== 1) refusals.push(`${label}: ${subject} hands its routes to the sub-router ${handoff.uses} times; expected exactly 1`);
  return { operations, refusals };
}

// Loads a plain route file with expressModule.Router swapped for the record's
// stub: `load` requires it fresh and gives back its module.exports. The
// test-support gate is held open while it loads (NODE_ENV not production,
// ENABLE_TEST_SUPPORT_ROUTES=true), so the routes registered behind it are
// recorded as the text reads them; both are restored after.
function recordRouteFile(load, expressModule, label, handoff = null) {
  const saved = { NODE_ENV: process.env.NODE_ENV, ENABLE_TEST_SUPPORT_ROUTES: process.env.ENABLE_TEST_SUPPORT_ROUTES };
  process.env.NODE_ENV = 'test';
  process.env.ENABLE_TEST_SUPPORT_ROUTES = 'true';
  try {
    return recordRouter(load, expressModule, label, 'the route file', 'export', handoff);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Both readings of one plain route file, `METHOD <path>` as written: every
// literal registration the text reads must be in the record (else it runs on
// a branch the load skips, or later, inside a handler), and every recorded one
// must be in the text (else it was registered through a second handle, a
// computed or spaced member access, or a variable path).
function routeRecordRefusals(source, label, record) {
  const refusals = [...record.refusals];
  const recorded = new Set(record.operations.map((op) => `${op.method} ${op.path}`));
  const read = new Set();
  for (const match of source.matchAll(ROUTE_START)) {
    if (match[3] === undefined) continue;
    const key = `${match[1].toUpperCase()} ${match[3]}`;
    read.add(key);
    if (!recorded.has(key)) refusals.push(`${label}:${lineOf(source, match.index)} ${key} is not registered when the file loads, so it runs on a branch or later`);
  }
  for (const key of recorded) {
    if (!read.has(key)) refusals.push(`${label}: ${key} is registered when the file loads, but no router.<method>('<path>' in its text reads it`);
  }
  return refusals;
}

// The record of the route file `file`, required fresh with express.Router
// swapped, memoised so a file mounted twice loads once. Its require.cache
// entry is put back as it was after, throw or not, so no later require of the
// file gets the stub (which has no `stack`) as its router.
const routeRecords = new Map();
function routeFileRecord(file) {
  if (!routeRecords.has(file)) {
    const prior = require.cache[file];
    const load = () => {
      delete require.cache[file];
      return require(file);
    };
    try {
      routeRecords.set(file, recordRouteFile(load, createRequire(file)('express'), relOf(file)));
    } finally {
      delete require.cache[file];
      if (prior) require.cache[file] = prior;
    }
  }
  return routeRecords.get(file);
}

// A stand-in for the router module a KNOWN_HANDOFFS file requires: the record
// lets it be passed only as the last argument of router.use(, and every other
// touch of it (a property or descriptor read, a write, a call, `in`, a
// prototype or extensibility read or change) is refused, since it could register on the real sub-router out of sight.
function handoffSentinel(label) {
  const touched = [];
  const refuse = (what) => { touched.push(`${label}: ${what} the sub-router, a shape the record does not read`); };
  const sentinel = new Proxy(function subRouter() {}, {
    get(_t, prop) { refuse(`reads ${String(prop)} of`); return undefined; },
    set(_t, prop) { refuse(`sets ${String(prop)} on`); return true; },
    apply() { refuse('calls'); return undefined; },
    construct() { refuse('constructs'); return {}; },
    has() { refuse('tests a key of'); return false; },
    defineProperty() { refuse('defines a property on'); return true; },
    deleteProperty() { refuse('deletes a property of'); return true; },
    getPrototypeOf() { refuse('reads the prototype of'); return Function.prototype; },
    ownKeys() { refuse('lists the keys of'); return ['prototype']; },
    getOwnPropertyDescriptor(t, prop) { refuse(`reads the descriptor of ${String(prop)} of`); return Reflect.getOwnPropertyDescriptor(t, prop); },
    isExtensible(t) { refuse('tests the extensibility of'); return Reflect.isExtensible(t); },
    preventExtensions() { refuse('prevents extensions of'); return false; },
    setPrototypeOf() { refuse('sets the prototype of'); return false; },
  });
  return { sentinel, touched, uses: 0 };
}

// The record of a KNOWN_HANDOFFS file: loaded like a plain route file, with
// its sub-router module's require.cache entry swapped for a handoffSentinel,
// so its own registrations are recorded and its hand-off counted. Both cache
// entries are put back as they were after, throw or not.
function recordHandoff(load, expressModule, label, handoff) {
  const record = recordRouteFile(load, expressModule, label, handoff);
  return { operations: record.operations, refusals: [...record.refusals, ...handoff.touched] };
}
function handoffRecord(file) {
  const label = relOf(file);
  const { request } = KNOWN_HANDOFFS.get(label);
  const target = handoffTarget(file, request);
  if (!target) return { operations: [], refusals: [`${label}: ${request} does not resolve`] };
  const prior = { file: require.cache[file], target: require.cache[target] };
  const handoff = handoffSentinel(label);
  const stand = new (require('node:module'))(target, null);
  stand.filename = target;
  stand.loaded = true;
  stand.exports = handoff.sentinel;
  try {
    require.cache[target] = stand;
    return recordHandoff(() => {
      delete require.cache[file];
      return require(file);
    }, createRequire(file)('express'), label, handoff);
  } finally {
    delete require.cache[file];
    delete require.cache[target];
    if (prior.file) require.cache[file] = prior.file;
    if (prior.target) require.cache[target] = prior.target;
  }
}

// The registrations, as `METHOD /prefix/path`, the factory mounts at `prefix`
// make, recorded by calling each factory with its mount's own options, and
// the refusals: the record's own, and every literal registration in the
// factory module's text that the record did not see at this mount (one on a
// branch this mount's options skip, or one run later, inside a handler).
function factoryOperations(prefix, entries) {
  const operations = new Set();
  const refusals = [];
  const appRequire = createRequire(APP_JS);
  for (const entry of entries) {
    const label = `app.js:${entry.line} ${entry.name}`;
    const file = resolveModule(KNOWN_FACTORIES.get(entry.name));
    if (!file) {
      refusals.push(`${label}: ${KNOWN_FACTORIES.get(entry.name)} does not resolve`);
      continue;
    }
    const options = new Function('require', `return (${entry.options});`)(appRequire);
    const checked = checkFactory(readStripped(fs, file), path.relative(backendRoot, file), entry.name, appRequire(file), options, createRequire(file)('express'), prefix, label);
    refusals.push(...checked.refusals);
    for (const key of checked.operations) operations.add(key);
  }
  return { operations, refusals };
}

// Both readings of one factory mount: the record of `factory(options)` and
// the factory module's text `source`, the factory function `name` in it. The
// text must hold no shape the extraction cannot read, every registration in
// it must be a statement of the factory's body, and every literal one must be
// in the record, so the record is the whole of what the text could register.
function checkFactory(source, file, name, factory, options, expressModule, prefix, label) {
  const record = recordFactory(factory, options, expressModule, label);
  const operations = new Set(record.operations.map((op) => `${op.method} ${joinPath(prefix, op.path)}`));
  const refusals = [
    ...record.refusals,
    ...routeFileRefusals(source, file),
    ...factoryFileRefusals(source, file, name),
    ...oddRouterUses(source, file),
    ...routerCallRefusals(source, file),
  ];
  for (const match of source.matchAll(ROUTE_START)) {
    if (match[3] === undefined) continue;
    const key = `${match[1].toUpperCase()} ${joinPath(prefix, match[3])}`;
    if (!operations.has(key)) refusals.push(`${file}:${lineOf(source, match.index)} ${key} is not registered when ${label} runs, so it runs on a branch or later`);
  }
  return { operations, refusals };
}

function joinPath(prefix, route) {
  const base = templated(prefix);
  const tail = templated(route);
  if (tail === '/' || tail === '') return base;
  return `${base.replace(/\/$/, '')}/${tail.replace(/^\//, '')}`;
}

// `METHOD /prefix/path` for every literal-path registration in the files
// mounted at `prefix`.
function collectOperations(prefix, files) {
  const operations = new Set();
  for (const file of files) {
    for (const match of readStripped(fs, file).matchAll(ROUTE_START)) {
      if (match[3] !== undefined) operations.add(`${match[1].toUpperCase()} ${joinPath(prefix, match[3])}`);
    }
  }
  return operations;
}

function readSpec() {
  return JSON.parse(fs.readFileSync(SPEC, 'utf8'));
}

function specOperations(spec) {
  const operations = [];
  for (const [route, item] of Object.entries(spec.paths || {})) {
    for (const key of Object.keys(item)) {
      if (HTTP_METHODS.has(key)) operations.push({ route, method: key, key: `${key.toUpperCase()} ${route}` });
    }
  }
  return operations;
}

test('RNF006: every operation the OpenAPI spec documents is registered under its app.js mount', () => {
  const spec = readSpec();
  const covered = spec['x-covered-mounts'] || [];
  const mounts = collectMounts();
  // The union over every covered mount: a path under a nested mount is also
  // under the mount it is nested in, so the first prefix it is under may not
  // be the one that registers it.
  const factoryMounts = collectFactoryMounts(readStripped(fs, APP_JS));
  const registered = new Set(covered.flatMap((p) => [
    ...collectOperations(p, expandFiles(mounts.get(p) || []).files),
    ...factoryOperations(p, factoryMounts.get(p) || []).operations,
  ]));
  const misses = [];
  for (const operation of specOperations(spec)) {
    const prefixes = covered.filter((p) => isUnder(operation.route, p));
    if (prefixes.length === 0) {
      misses.push(`${operation.key}: its path is under no x-covered-mounts prefix`);
      continue;
    }
    if (!registered.has(operation.key)) {
      misses.push(`${operation.key}: no such registration under ${prefixes.join(' or ')} in app.js`);
    }
  }
  assert.deepStrictEqual(misses, [], `The spec documents operations the code does not register:\n${misses.join('\n')}`);
});

test('RNF006: every operation registered under a covered mount is documented', () => {
  const spec = readSpec();
  const covered = spec['x-covered-mounts'] || [];
  const documented = new Set(specOperations(spec).map((operation) => operation.key));
  const mounts = collectMounts();
  const appSource = readStripped(fs, APP_JS);
  const misses = appRefusals(appSource, 'app.js', covered);
  const usePrefixes = new Set([...appSource.matchAll(APP_CALL)]
    .filter((match) => match[1] === 'use')
    .map((match) => templated(literalOf(callArgs(appSource, match.index + match[0].length - 1)[0] || '') || '')));
  for (const key of KNOWN_ANCESTORS.keys()) {
    if (!usePrefixes.has(key)) misses.push(`KNOWN_ANCESTORS names ${key}, which app.js no longer mounts`);
  }
  for (const name of KNOWN_LIMITERS) {
    if (!new RegExp(`\\bconst\\s+${name}\\s*=\\s*rateLimit\\s*\\(`).test(appSource)) {
      misses.push(`KNOWN_LIMITERS names ${name}, which app.js does not declare as const ${name} = rateLimit(...)`);
    }
  }
  for (const name of KNOWN_FACTORIES.keys()) {
    if (!factoryDeclared(appSource, name)) {
      misses.push(`KNOWN_FACTORIES names ${name}, which app.js does not bind once as const ${name} = require("${KNOWN_FACTORIES.get(name)}")`);
    }
  }
  const mountedFiles = new Set([...mounts.values()].flatMap((files) => [...files].map(relOf)));
  for (const [rel, entry] of KNOWN_SUBROUTERS) {
    if (!mountedFiles.has(rel) || !delegationOf(readStripped(fs, path.join(backendRoot, rel)), rel)) {
      misses.push(`KNOWN_SUBROUTERS names ${rel}, which app.js does not mount or which no longer hands its routes to ${entry.request} in a modeled shape`);
    }
  }
  for (const [rel, { request }] of KNOWN_HANDOFFS) {
    if (!mountedFiles.has(rel) || !handoffOf(readStripped(fs, path.join(backendRoot, rel)), rel)) {
      misses.push(`KNOWN_HANDOFFS names ${rel}, which app.js does not mount or which no longer hands its routes to ${request} in the modeled shape`);
    }
  }
  const factoryMounts = collectFactoryMounts(appSource);
  for (const prefix of covered) {
    const files = mounts.get(prefix) || new Set();
    const entries = factoryMounts.get(prefix) || [];
    if (files.size === 0 && entries.length === 0) {
      misses.push(`${prefix}: not mounted with require() or a known factory in app.js`);
      continue;
    }
    for (const file of files) {
      const s = readStripped(fs, file);
      misses.push(...routeFileRefusals(s, path.relative(backendRoot, file), delegationOf(s, relOf(file)) || handoffOf(s, relOf(file))));
    }
    const expanded = expandFiles(files);
    misses.push(...expanded.refusals);
    const recorded = factoryOperations(prefix, entries);
    misses.push(...recorded.refusals);
    const operations = new Set([...collectOperations(prefix, expanded.files), ...recorded.operations]);
    // A KNOWN_SUBROUTERS file is read by its exact text alone: its router
    // module, in expanded.files too, is the one recorded.
    for (const file of expanded.files) {
      const source = readStripped(fs, file);
      if (delegationOf(source, relOf(file))) continue;
      const record = KNOWN_HANDOFFS.has(relOf(file)) ? handoffRecord(file) : routeFileRecord(file);
      misses.push(...routeRecordRefusals(source, relOf(file), record));
      for (const op of record.operations) operations.add(`${op.method} ${joinPath(prefix, op.path)}`);
    }
    if (operations.size === 0) misses.push(`${prefix}: its route files register no operation`);
    for (const key of operations) {
      if (!documented.has(key)) misses.push(`${key}: registered but not in docs/api/openapi.json`);
    }
  }
  assert.deepStrictEqual(misses, [], `Operations under a covered mount are not documented, or cannot be read:\n${misses.join('\n')}`);
});

test('RNF006: the spec is OpenAPI 3.0 and every path template parameter is declared', () => {
  const spec = readSpec();
  assert.match(String(spec.openapi), /^3\.0\.\d+$/);
  assert.ok(
    Array.isArray(spec['x-covered-mounts']) && spec['x-covered-mounts'].length > 0,
    'x-covered-mounts must be a non-empty array'
  );
  const misses = [];
  for (const [route, item] of Object.entries(spec.paths || {})) {
    const template = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    const pathLevel = (item.parameters || []).filter((p) => p.in === 'path').map((p) => p.name);
    for (const method of Object.keys(item).filter((key) => HTTP_METHODS.has(key))) {
      const declared = new Set([
        ...pathLevel,
        ...(item[method].parameters || []).filter((p) => p.in === 'path').map((p) => p.name),
      ]);
      for (const name of template) {
        if (!declared.has(name)) misses.push(`${method.toUpperCase()} ${route}: {${name}} is not a declared path parameter`);
      }
      for (const name of declared) {
        if (!template.includes(name)) misses.push(`${method.toUpperCase()} ${route}: path parameter ${name} is not in the template`);
      }
    }
  }
  assert.deepStrictEqual(misses, [], misses.join('\n'));
});

// Without this, the refusals above would pass just as happily if they could
// never fire, since no covered file holds such a shape today. Each shape is
// one the extraction cannot read; each must be refused, and the clean
// sources, written in the covered files' own shapes, must not be.
test('RNF006: the guard refuses each route shape it cannot read', () => {
  const covered = ['/api/auth', '/api/backup', '/api/biobanks/miabis', '/api/export/fhir', '/api/export/fhir/samples/{specimenId}/files/{fileID}', '/api/studies'];
  const sub = 'require("./src/interface/routes/sub.routes")';
  const app = [
    'app.use(globalLimiter);',
    'app.use("/api/auth", authLimiter);',
    'app.use("/api/backup/restore", authLimiter);',
    'app.use("/api/backup", require("./src/interface/routes/backup.routes"));',
    'app.use("/api/backup", require("./src/interface/routes/backup.routes"));',
    'app.use("/api/export/fhir/samples/:specimenId/files/:fileID", require("./src/interface/routes/fhir-document-reference-export.routes"));',
    'app.use("/api/export/fhir", require("./src/interface/routes/fhir-export.routes"));',
    'app.use("/api/biobanks/miabis", require("./src/interface/routes/miabis-export.routes"));',
    'app.use("/api/biobanks", createMasterDataRouter({ collectionName: "biobanks" }));',
    'const createMasterDataRouter = require("./src/interface/routes/master-data.routes");',
    'app.use("/api/studies", createMasterDataRouter({\n  collectionName: "studies",\n  idField: "studyId",\n  model: require("./src/models/Study")\n}));',
    'app.use(\n  cors({ origin: (origin, callback) => callback(null, true) })\n);',
    'app.use("/api/patients", require("./src/interface/routes/patient.routes"));',
    'app.get("/api/health", async (req, res) => { res.status(200).json({ ok: true }); });',
  ].join('\n');
  const route = [
    "const express = require('express');",
    'const router = express.Router();',
    "const { authenticate } = require('../../infrastructure/middleware/auth');",
    'router.use(authenticate);',
    "router.use(requirePermission('manageBackup'));",
    "router.get('/list', async (req, res) => res.status(200).json({ ok: req.get('x-request-id') }));",
    'router.post(\n  "/restore/:fileName",\n  handler\n);',
    'module.exports = router;',
  ].join('\n');

  assert.deepStrictEqual(appRefusals(app, 'app.js', covered), []);
  assert.deepStrictEqual(routeFileRefusals(route, 'backup.routes.js'), []);

  const appShapes = {
    'a template-literal prefix': `app.use(\`\${API}/backup\`, ${sub});`,
    'a concatenated prefix': `app.use(API + "/backup", ${sub});`,
    'an identifier prefix': `app.use(BP, ${sub});`,
    'middleware before the require': `app.use("/api/backup", authenticate, ${sub});`,
    'a variable-held router': `const extra = ${sub};\napp.use("/api/backup", extra);`,
    'a mount below a covered prefix': `app.use("/api/backup/deep", ${sub});`,
    'a known limiter beside a router below a covered prefix': `app.use("/api/backup/deep", authLimiter, ${sub});`,
    'an unknown middleware below a covered prefix': 'app.use("/api/backup/deep", otherLimiter);',
    'a mount below a covered parameterised mount': `app.use("/api/export/fhir/samples/:specimenId/files/:fileID/more", ${sub});`,
    'a parameterised mount below a covered prefix': `app.use("/api/backup/:id/files", ${sub});`,
    'app.get under a covered prefix': 'app.get("/api/backup/direct", handler);',
    'app.route under a covered prefix': 'app.route("/api/backup/r").get(handler);',
    'an uncovered mount above a covered prefix': `app.use("/api/export", ${sub});`,
    'a parameterised mount above a covered prefix': `app.use("/api/:area", ${sub});`,
    'a master-data router above a covered prefix': 'app.use("/api/export", createMasterDataRouter({ collectionName: "x" }));',
    'a known ancestor above an unlisted covered prefix': `app.use("/api/biobanks/other", ${sub});`,
    'an optional-parameter mount above a covered prefix': `app.use("/api/:area?", ${sub});`,
    'a literal mount above a parameterised covered prefix': `app.use("/api/x/y", ${sub});`,
    'a factory called with no object literal': 'app.use("/api/studies", createMasterDataRouter(options));',
    'a factory called with a second argument': 'app.use("/api/studies", createMasterDataRouter({ collectionName: "s" }, extra));',
    'a factory call chained': 'app.use("/api/studies", createMasterDataRouter({ collectionName: "s" }).use(other));',
    'a factory call called again': 'app.use("/api/studies", createMasterDataRouter({ collectionName: "s" })(other));',
    'a factory call in an expression': 'app.use("/api/studies", createMasterDataRouter({ collectionName: "s" }) || other);',
    'an unknown factory': 'app.use("/api/studies", createOtherRouter({ collectionName: "s" }));',
    'middleware before a factory': 'app.use("/api/studies", authenticate, createMasterDataRouter({ collectionName: "s" }));',
    'a factory mount below a covered prefix': 'app.use("/api/studies/deep", createMasterDataRouter({ collectionName: "s" }));',
    'a factory rebound in app.js': 'createMasterDataRouter = require("./src/interface/routes/other.routes");',
  };
  // Covered prefixes for one shape only: added to the shared list, the clean
  // /api/biobanks line would be refused too. /api/x/{id}/files puts the
  // {param} on the covered side, opposite the shape's literal y.
  const shapeCovered = {
    'a known ancestor above an unlisted covered prefix': [...covered, '/api/biobanks/other'],
    'a literal mount above a parameterised covered prefix': [...covered, '/api/x/{id}/files'],
  };
  const routeShapes = {
    'a router.route chain': "router.route('/chained').get(handler).post(handler);",
    'router.all': "router.all('/anything', handler);",
    'router.options': "router.options('/opt', handler);",
    'router.use with a path': "router.use('/sub', authenticate);",
    'router.use of a required module': "router.use(require('./sub.routes'));",
    'router.use of a required identifier': "const sub = require('./sub.routes');\nrouter.use(sub);",
    'a second router': 'const r2 = express.Router();\nrouter.use(r2);',
    'an aliased router': "const r = router;\nr.get('/alias', handler);",
    'a registration with no literal path': 'router.get(paths.list, handler);',
  };
  // A factory bound from another module: the clean source with its binding swapped.
  const otherBinding = app.replace('"./src/interface/routes/master-data.routes"', '"./src/interface/routes/other.routes"');
  assert.notDeepStrictEqual(appRefusals(otherBinding, 'app.js', covered), []);
  // A factory is checked by running it: each shape is a factory source,
  // evaluated with a stand-in express whose own Router() gives a router that
  // is not the record's, and checked as mounted at /api/studies with
  // { collectionName: 'studies' } (scopeField unset).
  const fakeExpress = { Router: () => ({ stack: [], get() { return this; }, use() { return this; } }) };
  // An app as express() makes it: a function with handle and set, and no stack.
  const expressApp = () => Object.assign(function app() {}, { handle() {}, set() {}, get() { return this; } });
  const checkShape = (text) => {
    const factory = new Function('express', 'expressApp', 'module', 'handler', 'authenticate', 'requireRole', 'register', 'other', `${text}\nreturn createMasterDataRouter;`)(
      fakeExpress, expressApp, {}, () => {}, () => {}, () => () => {}, () => {}, Object.assign(() => {}, { stack: [], handle() {} })
    );
    return checkFactory(text, 'master-data.routes.js', 'createMasterDataRouter', factory, { collectionName: 'studies' }, fakeExpress, '/api/studies', 'app.js:1 createMasterDataRouter');
  };
  const factory = [
    'function createMasterDataRouter({ collectionName, scopeField = null }) {',
    '  const router = express.Router();',
    '  router.use(authenticate);',
    '  if (scopeField) {',
    '    router.use(requireOrganizationScope);',
    '  }',
    "  router.get('/', async (req, res) => res.status(200).json({ name: `${collectionName}` }));",
    "  router.delete('/:id', requireRole(3, 4), handler);",
    '  return router;',
    '}',
    'module.exports = createMasterDataRouter;',
  ].join('\n');
  const clean = checkShape(factory);
  assert.deepStrictEqual(clean.refusals, []);
  assert.deepStrictEqual([...clean.operations], ['GET /api/studies', 'DELETE /api/studies/{id}']);
  const inBody = (text) => factory.replace('  return router;', `${text}\n  return router;`);
  const factoryShapes = {
    'a registration inside an if': inBody("  if (scopeField) {\n    router.get('/scoped', handler);\n  }"),
    'a registration in a brace-less if': inBody("  if (scopeField) router.get('/cond', handler);"),
    'a registration in a ternary': inBody("  scopeField ? router.get('/cond', handler) : null;"),
    'a registration after &&': inBody("  scopeField && router.get('/cond', handler);"),
    'a registration in a loop with a computed path': inBody("  for (const p of ['/a']) router.get(p, handler);"),
    'a registration inside a handler': inBody("  router.post('/', (req, res) => { router.get('/late', handler); });"),
    'a registration inside an inner function': inBody("  function extra() {\n    router.post('/extra', handler);\n  }"),
    'a braced early return before a registration': inBody("  if (collectionName) {\n    return router;\n  }\n  router.get('/after', handler);"),
    'an early return of another router': inBody('  if (collectionName) {\n    return express.Router();\n  }'),
    'a registration inside a skipped template literal': inBody("  const s = collectionName ? '' : `${router.get('/t', handler)}`;"),
    'a regex literal with a quote before a skipped registration': inBody("  const re = /'/;\n  if (scopeField) { router.get('/re', handler); }"),
    'a split member access': inBody("  router.post('/', (req, res) => { router\n.get('/split', handler); });"),
    'a computed member access': inBody("  router['get']('/computed', handler);"),
    'an aliased router': inBody("  const r = router;\n  r.get('/alias', handler);"),
    'the router handed to other code': inBody('  register(router);'),
    'router.route': inBody("  router.route('/chained').get(handler);"),
    'router.all': inBody("  router.all('/anything', handler);"),
    'router.use with a path': inBody("  router.use('/sub', handler);"),
    'router.use of another router': inBody('  router.use(other);'),
    'a second router built': inBody('  const r2 = express.Router();'),
    'a registration with a regex path': inBody('  router.get(/x/, handler);'),
    'a factory returning another router': factory.replace('  return router;', '  return other;'),
    'a factory that throws': inBody("  throw new Error('no');"),
    'a Router taken before the record': `const { Router } = express;\n${factory.replace('express.Router()', 'Router()')}`,
    'a registration chained on router.use': inBody("  router.use(authenticate).get('/chained', handler);"),
    'a chained registration after an early return': inBody("  if (scopeField) {\n    return router;\n  }\n  router.use(authenticate).get('/after', handler);"),
    'router.use of an express app': inBody("  const sub = expressApp();\n  const p = '/hidden';\n  sub.get(p, handler);\n  router.use(sub);"),
    'router.use of an arrow wrapping a router': inBody('  router.use((req, res, next) => other(req, res, next));'),
    'router.use of a bound router handle': inBody('  router.use(other.handle.bind(other));'),
    'a second return on a branch': inBody('  if (scopeField) return other;'),
    'a factory not exported': factory.replace('module.exports = createMasterDataRouter;', 'module.exports = { createMasterDataRouter };'),
    'a literal path with a computed tail': inBody("  router.get('/a' + collectionName, handler);"),
    'a factory rebound to return another router': factory.replace(
      'module.exports = createMasterDataRouter;',
      'createMasterDataRouter = ((f) => (o) => { f(o); return other; })(createMasterDataRouter);\nmodule.exports = createMasterDataRouter;'
    ),
  };
  // A route file handing its routes to one router module, written as
  // hpo.routes.js and dictionary.routes.js are, checked under their map keys.
  const HPO = 'src/interface/routes/hpo.routes.js';
  const DICTIONARY = 'src/interface/routes/dictionary.routes.js';
  const reexportText = ["const router = require('../../routes/hpo');", 'module.exports = router;'].join('\n');
  const useCall = 'router.use(authenticate, dictionaryRouter);';
  const useText = [
    "const express = require('express');",
    "const { authenticate } = require('../../infrastructure/middleware/auth');",
    "const dictionaryRouter = require('../../../src/routes/dictionary');",
    '',
    'const router = express.Router();',
    useCall,
    '',
    'module.exports = router;',
  ].join('\n');
  const delegated = (text, key) => routeFileRefusals(text, 'sub.routes.js', delegationOf(text, key));
  assert.deepStrictEqual(delegated(reexportText, HPO), []);
  assert.deepStrictEqual(delegated(useText, DICTIONARY), []);
  const target = "const router = express.Router(); router.get('/search', h); module.exports = router;";
  assert.deepStrictEqual(delegateRefusals(target, 'sub.js'), []);
  const inUse = (text) => useText.replace(useCall, text);
  // A second handle to a router, or a swapped export, each with a variable
  // path so no literal-path reading sees it.
  const handleLines = {
    'import() with a variable path': "import('../../../src/routes/dictionary').then((m) => m.default.get(P, h));",
    createRequire: "createRequire(__filename)('../../../src/routes/dictionary').get(P, h);",
    'module.constructor._load': "module.constructor._load('../../../src/routes/dictionary').get(P, h);",
    'module.parent.require': "module.parent.require('./src/routes/dictionary').get(P, h);",
    'process.mainModule.require': "process.mainModule.require('./src/routes/dictionary').get(P, h);",
    "module['exports'] =": "module['exports'] = sub;",
    'an alias of module': 'const m = module;\nm.exports = sub;',
    'Object.defineProperty(module, exports)': "Object.defineProperty(module, 'exports', { value: sub });",
  };
  const delegationShapes = {
    'a use text under a key not in the map': [useText, 'src/interface/routes/other.routes.js'],
    'a re-export followed by router.use with a path': [`${reexportText}\nrouter.use('/sub', x);`, HPO],
    'an aliased sub-router': [inUse(`const alias = dictionaryRouter;\n${useCall}`), DICTIONARY],
    'a use call inside a block': [inUse('if (flag) { x(); router.use(authenticate, dictionaryRouter); }'), DICTIONARY],
    'a path variable before the sub-router': [inUse("const p = '/sub';\nrouter.use(p, dictionaryRouter);"), DICTIONARY],
    'an added middleware': [inUse('router.use(authenticate, other, dictionaryRouter);'), DICTIONARY],
    'the sub-router not the last argument': [inUse('router.use(dictionaryRouter, authenticate);'), DICTIONARY],
    'a second use of the sub-router': [inUse(`${useCall}\n${useCall}`), DICTIONARY],
    'a require of another module under the same name': [useText.replace("'../../../src/routes/dictionary'", "'./other'"), DICTIONARY],
    'a second const require of the sub-router': [inUse(`${useCall}\nconst d2 = require('../../../src/routes/dictionary');\nd2.get('/x', h);`), DICTIONARY],
    'a let require of the sub-router': [inUse(`${useCall}\nlet d3 = require('../../../src/routes/dictionary');\nd3.get(P, h);`), DICTIONARY],
    'an inline require of the sub-router': [inUse(`${useCall}\nrequire('../../../src/routes/dictionary').get('/x', h);`), DICTIONARY],
    'a require of the sub-router by another spelling': [inUse(`${useCall}\nconst d2 = require('../../routes/dictionary.js');\nd2['get']('/x', h);`), DICTIONARY],
    'a require with no string literal': [inUse(`${useCall}\nconst m = '../../../src/routes/dictionary';\nrequire(m).get('/x', h);`), DICTIONARY],
    'a second module.exports assignment': [`${useText}\nmodule.exports = require('./secret');`, DICTIONARY],
    ...Object.fromEntries(Object.entries(handleLines).map(([name, line]) => [`${name} in the route file`, [inUse(`${useCall}\nconst P = '/x';\n${line}`), DICTIONARY]])),
    'a router.stack handle': [inUse(`${useCall}\nconst P = '/x';\nrouter.stack[0].handle.get(P, h);`), DICTIONARY],
  };
  const targetShapes = {
    'a target with a second Router': target.replace(' module.exports', ' const r2 = express.Router(); module.exports'),
    'a target that hands off again': target.replace(' module.exports', " router.use(require('./x')); module.exports"),
    'a target with no module.exports = router;': target.replace(' module.exports = router;', ''),
    'a target with a second module.exports assignment': `${target} module.exports = require('./secret');`,
    ...Object.fromEntries(Object.entries(handleLines).map(([name, line]) => [`${name} in the target`, target.replace(' module.exports', ` const P = '/x'; ${line} module.exports`)])),
  };
  // A plain route file is also loaded with a stand-in express and its
  // registrations recorded; each shape here is one the text alone passes.
  const recordShape = (text) => {
    const stand = { Router: () => ({ stack: [], get() { return this; }, use() { return this; } }) };
    const load = () => {
      const module = { exports: {} };
      new Function('require', 'module', 'handler', 'requirePermission', 'other', text)(
        (id) => (id === 'express' ? stand : { authenticate: () => {} }), module, () => {}, () => () => {}, Object.assign(() => {}, { stack: [] })
      );
      return module.exports;
    };
    return routeRecordRefusals(text, 'backup.routes.js', recordRouteFile(load, stand, 'backup.routes.js'));
  };
  assert.deepStrictEqual(recordShape(route), []);
  // After its record, a covered route file required again is its real router,
  // not the stub left in require.cache.
  const backupRoutes = path.join(backendRoot, 'src', 'interface', 'routes', 'backup.routes.js');
  routeFileRecord(backupRoutes);
  assert.ok(Array.isArray(require(backupRoutes).stack), 'backup.routes.js required after its record is not an express router');
  const recordShapes = {
    'a second handle with a variable path': "const r = router;\nconst P = '/alias';\nr.get(P, handler);",
    'a computed member registration': "router['post']('/computed', handler);",
    'a spaced member registration': "router .get('/spaced', handler);",
    'a registration on a branch the load skips': "if (Math.random() > 2) router.get('/branch', handler);",
    'a registration inside a handler': "router.post('/late', (req, res) => { router.get('/later', handler); });",
    'a route file exporting another router': 'module.exports = other;',
  };
  const unrefused = [
    ...Object.entries(recordShapes).filter(([, text]) => recordShape(`${route}\n${text}`).length === 0),
    ...Object.entries(appShapes).filter(([name, text]) => appRefusals(`${app}\n${text}`, 'app.js', shapeCovered[name] || covered).length === 0),
    ...Object.entries(routeShapes).filter(([, text]) => routeFileRefusals(`${route}\n${text}`, 'backup.routes.js').length === 0),
    ...Object.entries(factoryShapes).filter(([, text]) => checkShape(text).refusals.length === 0),
    ...Object.entries(delegationShapes).filter(([, [text, key]]) => delegated(text, key).length === 0),
    ...Object.entries(targetShapes).filter(([, text]) => delegateRefusals(text, 'sub.js').length === 0),
    // The exact text and the module count refuse these first, so each extra
    // check is held on its own.
    ...['a let require of the sub-router', 'an inline require of the sub-router', 'a require of the sub-router by another spelling', 'a require with no string literal']
      .filter((name) => requiresModuleOnce(delegationShapes[name][0], DICTIONARY, '../../../src/routes/dictionary'))
      .map((name) => [`${name}, read by requiresModuleOnce`]),
    ...[delegationShapes['a second module.exports assignment'][0], targetShapes['a target with a second module.exports assignment']]
      .filter((text) => exportsOnlyRouter(text))
      .map((text) => [`a second module.exports assignment, read by exportsOnlyRouter: ${text.slice(-40)}`]),
  ].map(([name]) => name);
  assert.deepStrictEqual(unrefused, [], `These shapes pass unrefused: ${unrefused.join(', ')}`);
  // A route file handing its routes to one router module with code of its
  // own around the hand-off, written as intakeWizard.routes.js is.
  const INTAKE = 'src/interface/routes/intakeWizard.routes.js';
  const handoffUse = 'router.use(authenticate, requirePermission(\'createSample\'), guard, intakeWizardRouter);';
  const handoffText = [
    "const express = require('express');",
    "const intakeWizardRouter = require('../../../src/routes/intakeWizard');",
    "const { authenticate } = require('../../infrastructure/middleware/auth');",
    'const router = express.Router();',
    'function guard(req, res, next) {',
    "  audit({ req, module: 'Cadastro' });",
    '  return next();',
    '}',
    handoffUse,
    'module.exports = router;',
  ].join('\n');
  const handedOff = (text, key = INTAKE) => routeFileRefusals(text, 'intake.routes.js', handoffOf(text, key));
  const handoffShape = (text) => {
    const stand = { Router: () => ({ stack: [], get() { return this; }, use() { return this; } }) };
    const handoff = handoffSentinel('intake.routes.js');
    const load = () => {
      const module = { exports: {} };
      new Function('require', 'module', 'requirePermission', 'audit', 'handler', 'wrap', text)(
        (id) => (id === 'express' ? stand : id === '../../../src/routes/intakeWizard' ? handoff.sentinel : { authenticate: () => {} }),
        module, () => () => {}, () => {}, () => {}, (r) => () => r
      );
      return module.exports;
    };
    return routeRecordRefusals(text, 'intake.routes.js', recordHandoff(load, stand, 'intake.routes.js', handoff));
  };
  const intakeRoutes = path.join(backendRoot, 'src', 'interface', 'routes', 'intakeWizard.routes.js');
  handoffRecord(intakeRoutes);
  assert.ok(Array.isArray(require(intakeRoutes).stack), 'intakeWizard.routes.js required after its record is not an express router');
  assert.ok(Array.isArray(require(handoffTarget(intakeRoutes, KNOWN_HANDOFFS.get(INTAKE).request)).stack), 'its sub-router required after the record is not an express router');
  assert.notStrictEqual(handoffOf(handoffText, INTAKE), null);
  const intakeText = readStripped(fs, intakeRoutes);
  assert.notStrictEqual(handoffOf(intakeText, INTAKE), null, 'intakeWizard.routes.js no longer reads as a hand-off');
  assert.deepStrictEqual(routeFileRefusals(intakeText, INTAKE, handoffOf(intakeText, INTAKE)), []);
  assert.deepStrictEqual(handedOff(handoffText), []);
  assert.deepStrictEqual(handoffShape(handoffText), []);
  assert.strictEqual(moduleReferences("audit({ req, module: 'x' }); module.exports = router;"), 1);
  const inHandoff = (text) => handoffText.replace(handoffUse, text);
  const handoffTextShapes = {
    'a hand-off under a key not in the map': [handoffText, 'src/interface/routes/other.routes.js'],
    'an aliased sub-router': [inHandoff(`const alias = intakeWizardRouter;\n${handoffUse}`)],
    'the sub-router not the last argument': [inHandoff('router.use(intakeWizardRouter, authenticate);')],
    'a second router.use': [inHandoff(`${handoffUse}\nrouter.use(authenticate);`)],
    'a second use of the sub-router': [inHandoff(`${handoffUse}\n${handoffUse}`)],
    'a registration on the sub-router': [inHandoff(`${handoffUse}\nintakeWizardRouter.get(P, handler);`)],
    'a require of the sub-router by another spelling': [inHandoff(`${handoffUse}\nconst d2 = require('../../routes/intakeWizard.js');\nd2.get(P, handler);`)],
    'a let binding of the sub-router': [handoffText.replace('const intakeWizardRouter', 'let intakeWizardRouter')],
    'module named outside an object key': [inHandoff(`${handoffUse}\nconst m = flag ? module : null;`)],
    'module as a shorthand key': [inHandoff(`${handoffUse}\nconst o = { module };`)],
    'a wrapper reassigning router.use': [inHandoff(`const realUse = router.use;\nrouter.use = function (...a) { const P = '/x'; a[a.length - 1].get(P, handler); return realUse.apply(this, a); };\n${handoffUse}`)],
    'a router.stack read': [inHandoff(`${handoffUse}\nconst s = router.stack;`)],
    'a fourth router token': [inHandoff(`${handoffUse}\nconst r2 = router;`)],
    'a property set on the router': [inHandoff(`${handoffUse}\nrouter.extra = 1;`)],
    'the sub-router required through arguments': [inHandoff(`${handoffUse}\nconst P = '/x';\nconst d2 = arguments[1]('../../../src/routes/intakeWizard');\nd2.get(P, handler);`)],
    'a builtin module through process.getBuiltinModule': [inHandoff(`${handoffUse}\nconst M = process.getBuiltinModule('module');\nconst c = M._cache;`)],
    'the global object': [inHandoff(`${handoffUse}\nconst g = globalThis.x;`)],
    'a bare request not in the entry': [inHandoff(`${handoffUse}\nconst f = require('fs');`)],
    'the module builtin by its node: name': [inHandoff(`${handoffUse}\nconst M = require('node:module');`)],
    'a backslash-escaped relative request': [inHandoff(`${handoffUse}\nconst P = '/x';\nconst d2 = require('../../../src/routes/intake\\u0057izard');\nd2.get(P, handler);`)],
    ...Object.fromEntries(Object.entries(handleLines).map(([name, line]) => [`${name} in a hand-off file`, [inHandoff(`${handoffUse}\nconst P = '/x';\n${line}`)]])),
  };
  const handoffRecordShapes = {
    'a registration on the router with a variable path': inHandoff(`${handoffUse}\nconst P = '/x';\nrouter.get(P, handler);`),
    'the sub-router not the last argument': inHandoff('router.use(intakeWizardRouter, authenticate);'),
    'the sub-router handed off twice': inHandoff(`${handoffUse}\nrouter.use(intakeWizardRouter);`),
    'the sub-router never handed off': inHandoff('router.use(authenticate);'),
    'the sub-router wrapped': inHandoff('router.use(authenticate, wrap(intakeWizardRouter));'),
    'a registration on the sub-router': inHandoff(`${handoffUse}\nconst P = '/x';\nintakeWizardRouter.get(P, handler);`),
    'a property read of the sub-router': inHandoff(`${handoffUse}\nconst s = intakeWizardRouter.stack;`),
    'a property set on the sub-router': inHandoff(`${handoffUse}\nintakeWizardRouter.extra = 1;`),
    'a wrapper reassigning router.use': inHandoff(`const realUse = router.use;\nrouter.use = function (...a) { const P = '/x'; a[a.length - 1].get(P, handler); return realUse.apply(this, a); };\n${handoffUse}`),
    'a property set on the router': inHandoff(`${handoffUse}\nrouter.extra = 1;`),
    'a descriptor read of the sub-router': inHandoff(`${handoffUse}\nconst d = Object.getOwnPropertyDescriptor(intakeWizardRouter, 'stack');`),
    'an extensibility test of the sub-router': inHandoff(`${handoffUse}\nconst e = Object.isExtensible(intakeWizardRouter);`),
    'the sub-router exported': inHandoff(`${handoffUse}\nmodule.exports = intakeWizardRouter;`).replace(/\nmodule\.exports = router;$/, ''),
  };
  const unhanded = [
    ...Object.entries(handoffTextShapes).filter(([, [text, key]]) => handedOff(text, key).length === 0),
    ...Object.entries(handoffRecordShapes).filter(([, text]) => handoffShape(text).length === 0).map(([name]) => [`${name}, recorded`]),
    ...['module named outside an object key in a target', 'module as a shorthand key in a target']
      .map((name, i) => [name, target.replace(' module.exports', [' const m = flag ? module : null;', ' const o = { module };'][i] + ' module.exports')])
      .filter(([, text]) => delegateRefusals(text, 'sub.js').length === 0),
  ].map(([name]) => name);
  assert.deepStrictEqual(delegateRefusals(target.replace(' module.exports', " audit({ req, module: 'x' }); module.exports"), 'sub.js'), []);
  assert.deepStrictEqual(unhanded, [], `These hand-off shapes pass unrefused: ${unhanded.join(', ')}`);
});
