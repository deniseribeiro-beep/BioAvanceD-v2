// node:test-only by contract (README.md Test Strategy — vitest is out of
// contract here). Do not port to vitest's import/expect: that exact swap
// caused #375. History: #138, #148, #182, #375, #393.
//
// #755 (follow-up to #749): src/config/env.js is a plain literal
// `module.exports = { ... }` with no `...process.env` spread, so a key some
// module reads as `env.FOO` but that env.js never declares is simply
// `undefined` — forever, silently. The read site's `|| '<default>'` fallback
// then wins every time, so:
//
//   - nothing errors at startup or at read time,
//   - the variable *looks* supported, because the code names it and every
//     sibling really is honoured,
//   - and a test that assigns onto the already-required env object
//     (`env.FOO = 'x'`) passes, because it never exercises the
//     process.env -> env.js hop at all.
//
// #749 sat undetected for exactly that reason. This guard turns the class
// into a test failure instead of a silent undefined.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const BACKEND_SRC = path.resolve(BACKEND_ROOT, 'src');
const ENV_MODULE = path.resolve(BACKEND_SRC, 'config/env.js');

// #777: app.js and server.js sit at the backend root, outside src/, and both
// do `const env = require("./src/config/env")`. Walking src/ alone skipped
// them -- app.js in particular wires the middleware stack and is a dense,
// security-relevant reader (`env.AUTH_RATE_LIMIT_RELAXED`, `env.NODE_ENV`
// at line 219). Listed explicitly rather than widening the walk to the whole
// backend root, which would pull in tests/ and scripts/ where a local `env`
// identifier means something else entirely -- the createFirstAdmin.js trap
// documented below.
const ROOT_ENTRYPOINTS = ['app.js', 'server.js', 'setup-env.js']
  .map((name) => path.resolve(BACKEND_ROOT, name))
  .filter((file) => fs.existsSync(file));

// Requiring env.js and taking Object.keys is deliberate over parsing its
// source: it stays correct automatically as keys are added, and a key whose
// value is undefined (`MONGO_URI: process.env.MONGO_URI` with nothing set)
// is still a declared key, which is exactly the distinction that matters
// here — declared-but-unset is fine, undeclared is the bug.
const DECLARED_KEYS = new Set(Object.keys(require(ENV_MODULE)));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage', 'docs'].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// #863: the previous filter required the literal substring "config/env" in
// the require() specifier, so a sibling import from inside src/config/
// itself -- `require('./env')`, used by both collections.js and redis.js --
// was invisible to this guard. Resolving each require() specifier against
// the requiring file's own directory and comparing the resolved path to
// ENV_MODULE is exact: it can't under-collect on a future '../env' or
// '../../config/env', and can't over-collect on some unrelated './env'
// module elsewhere that happens to share the name.
// #882: every sweep below runs on comment-stripped source. The read
// extractors are regexes over raw text, so prose matched them: a comment in
// user-security.service.js that merely mentioned a path ending `env.js` was
// reported as `reads env.js`, a key that does not exist and a read that never
// happened. That inverts this guard's one stated property -- under-collection
// is invisible, over-collection is loud and therefore always real -- and it
// penalises exactly the comment a reader most wants (one explaining *why* a
// file reads a key).
//
// Comments are blanked rather than deleted so byte offsets and line structure
// survive; nothing here depends on that today, but a future index-based
// report would.
//
// The scanner has to know about strings and regex literals, not just comment
// openers, because `'http://x'` and `/^https?:\/\//` both contain `//`.
// Treating either as a comment would blank real code, and this guard's
// dangerous failure direction is silently seeing *less*. `REGEX_ALLOWED_AFTER`
// is the standard "can a `/` start a regex here" heuristic: at the start of
// input, after an operator or opening bracket, or after a keyword that must be
// followed by an expression. A `/` in any other position is division.
const REGEX_ALLOWED_AFTER =
  /(?:^|[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await))\s*$/;

function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (c === '/' && d === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') {
          out += source[i];
          i += 1;
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        out += source[i];
        i += 1;
      }
      if (i < n) {
        out += source[i];
        i += 1;
      }
      continue;
    }

    if (c === '/' && REGEX_ALLOWED_AFTER.test(out.slice(-16))) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const ch = source[i];
        out += ch;
        i += 1;
        if (ch === '\\') {
          if (i < n) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

const REQUIRE_CALL = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolvesToEnvModule(file, spec) {
  if (!spec.startsWith('.')) return false;
  let resolved = path.resolve(path.dirname(file), spec);
  if (path.extname(resolved) === '') resolved += '.js';
  return resolved === ENV_MODULE;
}

function requiresEnvModule(file, content) {
  for (const match of content.matchAll(REQUIRE_CALL)) {
    if (resolvesToEnvModule(file, match[1])) return true;
  }
  return false;
}

function filesRequiringEnv() {
  return [...walk(BACKEND_SRC), ...ROOT_ENTRYPOINTS]
    .filter((file) => file !== ENV_MODULE)
    .map((file) => ({ file, content: stripComments(fs.readFileSync(file, 'utf8')) }))
    .filter(({ file, content }) => requiresEnvModule(file, content));
}

function relative(file) {
  return path.relative(path.resolve(__dirname, '../..'), file).replace(/\\/g, '/');
}

// Finds how a file binds config/env: either `const env = require(...)` (a
// "simple" binding whose reads look like `env.NAME`), or a destructured
// `const { NAME, ... } = require(...)` (#863: redis.js's shape, which pulls
// six REDIS_* names directly into scope). Both are followable; anything
// else -- a bare `require('./env')` with no assignment, a `require(...).X`
// chain, etc. -- is not, and is reported by the "binding this guard can
// follow" test below. Both regexes capture the require specifier too, so
// the match is only accepted once it resolves to ENV_MODULE.
const SIMPLE_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
const DESTRUCTURED_BINDING = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;

function envBinding(file, content) {
  for (const match of content.matchAll(SIMPLE_BINDING)) {
    if (resolvesToEnvModule(file, match[2])) {
      return { type: 'simple', name: match[1] };
    }
  }
  for (const match of content.matchAll(DESTRUCTURED_BINDING)) {
    if (resolvesToEnvModule(file, match[2])) {
      const names = match[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.split(':')[0].split('=')[0].trim());
      return { type: 'destructured', names };
    }
  }
  return null;
}

// Static `<binding>.NAME` reads. The negative lookbehind on `.` is what keeps
// `process.env.NAME` out: without it this sweep produces ~75 false positives
// (#755's own note, from the hand-run version of this check). It also excludes
// any other `x.env.NAME` shape for the same reason.
function staticReads(content, binding) {
  const pattern = new RegExp(`(?<!\\.)\\b${binding}\\.([A-Za-z_$][\\w$]*)`, 'g');
  const names = new Set();
  for (const match of content.matchAll(pattern)) {
    names.add(match[1]);
  }
  return names;
}

test('#755: every env.<NAME> read is declared in config/env.js', () => {
  const offenders = [];

  for (const { file, content } of filesRequiringEnv()) {
    const binding = envBinding(file, content);
    if (!binding) continue; // covered by the "binding this guard can follow" test below

    if (binding.type === 'simple') {
      for (const name of staticReads(content, binding.name)) {
        if (!DECLARED_KEYS.has(name)) {
          offenders.push(`${relative(file)} reads ${binding.name}.${name}`);
        }
      }
    } else {
      for (const name of binding.names) {
        if (!DECLARED_KEYS.has(name)) {
          offenders.push(`${relative(file)} destructures ${name} from config/env`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These reads resolve to undefined forever, because config/env.js never '
      + 'declares them. Add the key to env.js (reading it from process.env) '
      + 'or correct the read:\n  ' + offenders.join('\n  ')
  );
});

test('#777: the guard still collects both root entrypoints', () => {
  // This guard's failure mode is under-collecting files, which is invisible
  // by construction -- a narrowed scope makes every other test here pass
  // more easily. Pin the two root importers, plus the two #863 sibling
  // importers inside src/config/ itself (the ones the literal-path filter
  // could not see), by name so a future refactor that moves or renames any
  // of them fails loudly instead of silently shrinking coverage back to
  // what #777/#863 fixed.
  const collected = filesRequiringEnv().map(({ file }) => relative(file));

  // #873 adds a fourth shape: user-security.service.js reached env through
  // the api/backend/config/env.js re-export shim, which resolves to a
  // different file than src/config/env.js, so the exact-resolution collector
  // correctly excluded it and its reads went unchecked. The import is fixed;
  // pinning it here is what stops the same one-token slip recurring silently.
  for (const name of [
    'app.js',
    'server.js',
    'src/config/collections.js',
    'src/config/redis.js',
    'src/services/user-security.service.js',
  ]) {
    assert.ok(
      collected.includes(name),
      `${name} imports config/env but the guard did not collect it -- `
        + `coverage has silently narrowed (see #777/#863). Collected `
        + `${collected.length} files.`
    );
  }
});

test('#755: config/env is imported under a binding this guard can follow', () => {
  // A simple binding (`const env = require(...)`) or a destructured one
  // (`const { FOO } = require(...)`, #863) both keep every read of that
  // import checkable. Anything else -- no assignment, a property chain off
  // the require() call, a dynamic require -- takes its reads out of a shape
  // this guard can follow, silently exempting that file.
  const unfollowable = filesRequiringEnv()
    .filter(({ file, content }) => !envBinding(file, content))
    .map(({ file }) => relative(file));

  assert.deepEqual(
    unfollowable,
    [],
    'These files import config/env in a shape the undeclared-key guard cannot '
      + 'follow, so their reads are unchecked. Import it as '
      + '`const env = require(...)` or `const { NAME } = require(...)`, or '
      + 'extend the guard:\n  '
      + unfollowable.join('\n  ')
  );
});

test('#755: no dynamic env[...] read escapes the static guard', () => {
  // `env[someVariable]` cannot be resolved statically. #755 flagged this as
  // "probably fine to ignore, but worth confirming none exist" — confirmed
  // none exist among config/env's importers, and this keeps it that way
  // rather than leaving the next one invisible.
  //
  // Note for whoever trips this: src/scripts/createFirstAdmin.js does contain
  // `env[key]`, but its `env` is a function parameter defaulting to
  // process.env and that file never requires config/env, so it is correctly
  // out of scope here.
  const dynamic = [];

  for (const { file, content } of filesRequiringEnv()) {
    const binding = envBinding(file, content);
    if (!binding || binding.type !== 'simple') continue;
    const pattern = new RegExp(`(?<!\\.)\\b${binding.name}\\s*\\[`, 'g');
    if (pattern.test(content)) {
      dynamic.push(`${relative(file)} reads ${binding.name}[...]`);
    }
  }

  assert.deepEqual(
    dynamic,
    [],
    'Dynamic reads cannot be checked against env.js\'s declared keys. Either '
      + 'use a literal member read, or verify the key set by hand and add an '
      + 'explicit exemption here:\n  ' + dynamic.join('\n  ')
  );
});

// ---------------------------------------------------------------------
// #784: the mirror of the guard above. That guard catches an undeclared
// key being *read*; this one catches a declared key that is never read
// anywhere -- an operator sets it, sees config/env.js accept it, and the
// value goes nowhere. A key counts as "read" here through any of: an
// `env.NAME` property read via a followable binding (reusing the
// collector above), a name pulled directly out of a destructured
// `const { NAME } = require(...)` binding, or a direct `process.env.NAME`
// / `process.env['NAME']` read anywhere else in the backend.
// ---------------------------------------------------------------------

// Names read off a followable config/env binding: `env.NAME` through a
// simple binding, or `NAME` pulled directly out of a destructured one.
// This reuses the same collector the forward guard above uses, walked
// once more here to build the *read* side of the key set rather than to
// check it against DECLARED_KEYS.
function envModuleReadKeys() {
  const names = new Set();
  for (const { file, content } of filesRequiringEnv()) {
    const binding = envBinding(file, content);
    if (!binding) continue;
    if (binding.type === 'simple') {
      for (const name of staticReads(content, binding.name)) names.add(name);
    } else {
      for (const name of binding.names) names.add(name);
    }
  }
  return names;
}

const PROCESS_ENV_DOT = /process\.env\.([A-Za-z_][\w$]*)/g;
const PROCESS_ENV_BRACKET = /process\.env\[\s*['"]([^'"]+)['"]\s*\]/g;

// A direct `process.env.NAME` / `process.env['NAME']` read, anywhere
// under api/backend -- this walk already covers scripts/ and
// src/scripts/, since both sit under BACKEND_ROOT the same as src/ does
// -- except config/env.js itself.
//
// Excluding env.js here is load-bearing, not incidental: every declared
// key matches `process.env.NAME` inside its own declaration line, so
// scanning env.js would make DECLARED_KEYS a subset of readKeys by
// construction and this guard would pass unconditionally forever, having
// proven nothing. That is this test's version of a confident zero.
//
// Only .js files are walked (see `walk()` above), so a compose file, a
// Dockerfile, or a `.env*` example is never a source of a "read" here.
// Those are advertisement, not consumption: a key named in
// .env.docker.example but never touched by application code is exactly
// the defect this guard exists to catch, and letting the example file
// vouch for its own key would make the guard certify that deception
// instead of catching it.
function processEnvSweep() {
  const names = new Set();
  const scanned = [];
  for (const file of walk(BACKEND_ROOT)) {
    if (file === ENV_MODULE) continue;
    // #882: comment-stripped here too, and in this direction the stakes are
    // the opposite way round -- a key whose only `process.env.NAME` mention
    // lives in prose would otherwise vouch for itself and keep #784 green
    // over a key nothing reads. Measured when this landed: stripping removes
    // exactly one name from the sweep (`NAME`, out of this file's own
    // explanatory comments) and no declared key loses its only reader.
    const content = stripComments(fs.readFileSync(file, 'utf8'));
    let found = false;
    for (const match of content.matchAll(PROCESS_ENV_DOT)) {
      names.add(match[1]);
      found = true;
    }
    for (const match of content.matchAll(PROCESS_ENV_BRACKET)) {
      names.add(match[1]);
      found = true;
    }
    if (found) scanned.push(relative(file));
  }
  return { names, scanned };
}

// Keys that are genuinely read nowhere and are therefore real defects --
// NOT accepted patterns. Each entry names the open issue that carries it,
// and exists only so this guard can stay green while the remedy is
// decided. Delete the entry when the issue closes; do not add one
// without filing first.
//
// #874 closed FHIR_READ_MODE (deleted -- nothing read it, and the
// 'fhir-first' strategy it named existed nowhere else in code) and API_URL
// (deleted, together with its .env.docker.example line -- nothing consumed
// it either). One entry remains, carried by #874 as deliberately unbuilt
// work rather than a defect to delete:
//
// - AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY: its declaration,
//   .env.docker.example, and compose.test.yml (set to empty). No JS reads
//   it. Its sibling AUDIT_EXTERNAL_WITNESS_URL IS read (by
//   src/services/audit-witness.service.js and
//   scripts/audit-e2e-real.js), so the witness call is wired and the
//   signature check on it is the part left undone.
const READ_EXEMPT = new Set([
  'AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY',
]);

test('#784: every declared key in config/env.js is read somewhere', () => {
  const readKeys = new Set([...envModuleReadKeys(), ...processEnvSweep().names]);

  const offenders = [...DECLARED_KEYS].filter(
    (key) => !readKeys.has(key) && !READ_EXEMPT.has(key)
  );

  assert.deepEqual(
    offenders,
    [],
    'These keys are declared in config/env.js but read nowhere -- an '
      + 'operator sets them, sees env.js accept them, and the value goes '
      + 'nowhere. Either wire up a reader, remove the declaration, or add a '
      + 'filed exemption to READ_EXEMPT above:\n  ' + offenders.join('\n  ')
  );
});

test('#784: the process.env read sweep still collects known readers', () => {
  // The mirror image of #777's pin. #777's forward guard fails loud when
  // it under-collects: keys look undeclared and the suite goes red. This
  // inverse guard's read sweep fails the opposite way when it
  // over-collects: an over-broad process.env matcher makes every key look
  // read and the suite stays green forever, silently proving nothing. So
  // this pin does not just assert the sweep is non-empty -- it names two
  // real readers verified by hand this session and asserts a floor on the
  // total file count, so a sweep that quietly narrows (down to zero, or
  // to a trivial handful) is caught either way.
  const { scanned } = processEnvSweep();

  for (const name of [
    'src/services/mqtt-telemetry.service.js',
    'src/infrastructure/queue/TopologicalQuarantine.js',
  ]) {
    assert.ok(
      scanned.includes(name),
      `${name} reads process.env directly but the sweep did not collect it -- `
        + `coverage has silently narrowed. Collected ${scanned.length} files.`
    );
  }

  assert.ok(
    scanned.length >= 20,
    'Expected the process.env sweep to find at least 20 reading files, found '
      + `${scanned.length} -- coverage may have silently narrowed.`
  );
});

// ---------------------------------------------------------------------
// #882: the stripper the two sweeps above depend on. Both directions are
// pinned here, because they fail differently: under-stripping makes the
// guard loud about things that are not reads (the reported symptom), while
// over-stripping blanks real code and makes it silently see less (the
// dangerous one this guard family keeps re-learning -- #777, #863, #873).
// ---------------------------------------------------------------------

test('#882: comment text is not collected as an env read', () => {
  const source = [
    "const env = require('../config/env');",
    '// this reads env.INSIDE_LINE_COMMENT, or so a regex would think',
    '/* env.INSIDE_BLOCK_COMMENT',
    '   spanning env.SECOND_LINE too */',
    'const port = env.REAL_READ;',
  ].join('\n');

  assert.deepEqual(
    [...staticReads(stripComments(source), 'env')].sort(),
    ['REAL_READ'],
    'A comment naming a key is documentation, not a read -- collecting it '
      + 'makes this guard fail on prose, which trains readers to treat its '
      + 'failures as possibly spurious.'
  );
});

test('#882: stripping preserves code that only looks like a comment', () => {
  const source = [
    "const env = require('../config/env');",
    "const url = 'http://example.test/' + env.FROM_STRING_LINE;",
    'const tpl = `https://x/${env.FROM_TEMPLATE_LINE}`;',
    'const re = /^https?:\\/\\//;',
    'const after = env.AFTER_REGEX;',
    'const ratio = env.NUMERATOR / env.DENOMINATOR;',
  ].join('\n');

  assert.deepEqual(
    [...staticReads(stripComments(source), 'env')].sort(),
    ['AFTER_REGEX', 'DENOMINATOR', 'FROM_STRING_LINE', 'FROM_TEMPLATE_LINE', 'NUMERATOR'],
    'A `//` inside a string or a regex literal is not a comment opener. '
      + 'Blanking from one silently removes real reads from every sweep in '
      + 'this file, which is the invisible failure direction.'
  );

  assert.ok(
    stripComments(source).includes("require('../config/env')"),
    'Stripping must leave require() specifiers intact -- the collector runs '
      + 'on stripped source, so eating one silently narrows coverage.'
  );
});

test('#784: the read-exemption set has not grown', () => {
  // Growing this set is a review event, not a fix: each entry is a real
  // defect carried by #874 until it is closed, not an accepted pattern to
  // add to casually. A change to this number should come with a filed
  // issue reference in the comment above, same convention as
  // UNWRITTEN_KEY_EXEMPT in filter-keys.arch.test.js.
  assert.equal(READ_EXEMPT.size, 1);
});
