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

const REQUIRES_ENV = /require\(\s*['"][^'"]*config\/env['"]\s*\)/;

// Captures the local binding: `const env = require('.../config/env')`.
const ENV_BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"][^'"]*config\/env['"]\s*\)/;

// A destructured import would read `const { FOO } = require('.../config/env')`,
// which this guard cannot follow — asserted against separately below.
const ENV_DESTRUCTURED = /(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(\s*['"][^'"]*config\/env['"]\s*\)/;

function filesRequiringEnv() {
  return [...walk(BACKEND_SRC), ...ROOT_ENTRYPOINTS]
    .filter((file) => file !== ENV_MODULE)
    .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
    .filter(({ content }) => REQUIRES_ENV.test(content));
}

function relative(file) {
  return path.relative(path.resolve(__dirname, '../..'), file).replace(/\\/g, '/');
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
    const bindingMatch = content.match(ENV_BINDING);
    if (!bindingMatch) continue; // covered by the destructuring test below
    const binding = bindingMatch[1];

    for (const name of staticReads(content, binding)) {
      if (!DECLARED_KEYS.has(name)) {
        offenders.push(`${relative(file)} reads ${binding}.${name}`);
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
  // more easily. Pin the two root importers by name so a future refactor
  // that moves or renames them fails loudly instead of silently shrinking
  // coverage back to what #777 fixed.
  const collected = filesRequiringEnv().map(({ file }) => relative(file));

  for (const name of ['app.js', 'server.js']) {
    assert.ok(
      collected.includes(name),
      `${name} imports config/env but the guard did not collect it -- `
        + `coverage has silently narrowed (see #777). Collected `
        + `${collected.length} files.`
    );
  }
});

test('#755: config/env is imported under a binding this guard can follow', () => {
  // A destructured import (`const { FOO } = require('config/env')`) would take
  // its reads out of the `env.NAME` shape the guard above matches, silently
  // exempting that file. All 26 current importers use `const env = ...`; this
  // fails if a future one does not, rather than quietly losing coverage.
  const unfollowable = filesRequiringEnv()
    .filter(({ content }) => ENV_DESTRUCTURED.test(content) || !ENV_BINDING.test(content))
    .map(({ file }) => relative(file));

  assert.deepEqual(
    unfollowable,
    [],
    'These files import config/env in a shape the undeclared-key guard cannot '
      + 'follow, so their reads are unchecked. Import it as '
      + '`const env = require(...)`, or extend the guard:\n  '
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
    const bindingMatch = content.match(ENV_BINDING);
    if (!bindingMatch) continue;
    const binding = bindingMatch[1];
    const pattern = new RegExp(`(?<!\\.)\\b${binding}\\s*\\[`, 'g');
    if (pattern.test(content)) {
      dynamic.push(`${relative(file)} reads ${binding}[...]`);
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
