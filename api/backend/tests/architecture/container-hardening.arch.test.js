// node:test-only by contract (README.md Test Strategy -- vitest is out of
// contract here). Do not port to vitest's import/expect.
//
// RNF014 C1-C3 and C7 (#1470): compose.prod.yml and the Dockerfiles it
// builds are the production stack's declarative artifacts, and this file
// pins what they promise:
//   C1  every image is pinned by an exact version or a digest;
//   C2  no secret is baked into an image: a build context that copies the
//       whole tree excludes .env files, and no build arg, ENV or COPY names
//       a secret;
//   C3  every service has CPU and memory limits, and every service but the
//       four official-image data stores runs read_only, with cap_drop ALL
//       and a non-root user;
//   C7  the backend refuses to start without a ready ReadinessReport, and
//       the API and both workers start only after the Foundation job
//       completes. The refusal itself is proven in
//       tests/unit/server.startServer.1098.test.js ("RF022 Foundation
//       readiness gate").
//
// compose.prod.yml is read by a small parser that models only the shapes
// this file uses and refuses every other line: an unknown key (cap_add,
// privileged, extends, a merge key), a quoted or oddly indented key, a tab,
// an anchor or a flow mapping where a block is read. A refusal names the
// line; widen the parser on purpose, never by loosening a check. The
// "refuses" cases below plant one bypass each and must stay red-on-revert.
//
// Does NOT run on CI, and skips there by design (#1190): CI runs
// test:architecture inside backend-unit-runner, whose image holds only
// api/backend. It runs natively, wherever the repo tree is present.

const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const COMPOSE_PROD = path.resolve(REPO_ROOT, 'compose.prod.yml');

const IN_REPO_TREE = fs.existsSync(path.join(REPO_ROOT, 'api', 'backend', 'package.json'));
const test = IN_REPO_TREE
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: '#1190: repo tree not reachable (expected inside backend-unit-runner)' }, fn);

// The third-party data stores run their official images, whose entrypoints
// start as root to prepare their data directory. RNF014 C3's limits apply to
// them; read_only, cap_drop and the non-root user apply to every other
// service. An exempt service must run an image, never a build (asserted).
const OFFICIAL_IMAGE_SERVICES = ['mongodb', 'neo4j', 'influxdb', 'redis'];

// The keys the parser models. Any other key is refused, so nothing these
// checks do not read (cap_add, privileged, security_opt, extends, a merge
// key, a build target) can undo what they assert.
const TOP_LEVEL_KEYS = ['name', 'services', 'volumes'];
const SERVICE_KEYS = ['image', 'build', 'restart', 'init', 'user', 'deploy', 'environment', 'volumes', 'healthcheck', 'command', 'env_file', 'depends_on', 'read_only', 'cap_drop', 'tmpfs', 'ports'];
const BUILD_KEYS = ['context', 'dockerfile', 'args'];

// An exact x.y.z version (with an optional suffix such as -alpine), or a
// sha256 digest, or both.
const PINNED_IMAGE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::\d+\.\d+\.\d+(?:[-.][A-Za-z0-9._-]+)?)?(?:@sha256:[0-9a-f]{64})?$/;
const SECRET_NAME = /PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE|API_KEY/i;
// A key line: a bare key (no quote, no merge key), then nothing or a value.
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ ]+(.*?))?[ ]*$/;
// A numeric uid, with an optional numeric gid, neither of them 0.
const NUMERIC_NON_ROOT = /^0*[1-9]\d*(?::0*[1-9]\d*)?$/;

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function indentOf(line) {
  return /^ */.exec(line)[0].length;
}

// A trailing comment is dropped only from a line holding no quote, so a #
// inside a quoted value is never cut; a quoted value with a comment after it
// then reads as unpinned or unreadable, which refuses.
function stripComment(line) {
  return /["']/.test(line) ? line : line.replace(/(^|\s)#.*$/, '');
}

// The block mapping at exactly `indent` spaces: each line at that indent is
// `key:` or `key: value`, each key once, and deeper lines are the children of
// the key above them. Any other line refuses.
function mapping(lines, indent, where) {
  const out = new Map();
  let current = null;
  for (const line of lines) {
    const n = indentOf(line);
    if (n > indent && current) {
      assert.equal(current.value, '', `${where}: lines indented under a key that already has a value are not modelled: ${JSON.stringify(line)}`);
      current.children.push(line);
      continue;
    }
    assert.equal(n, indent, `${where}: unreadable line, expected a key at ${indent} spaces: ${JSON.stringify(line)}`);
    const m = KEY_LINE.exec(line.slice(indent));
    assert.ok(m, `${where}: unreadable key line: ${JSON.stringify(line)}`);
    assert.ok(!out.has(m[1]), `${where}: key ${m[1]} is declared twice`);
    current = { value: m[2] === undefined ? '' : m[2], children: [] };
    out.set(m[1], current);
  }
  return out;
}

// A key that holds a block: no inline value (an anchor, an alias, a flow
// mapping) and at least one child line.
function block(entry, where) {
  assert.ok(entry, `${where} is missing`);
  assert.equal(entry.value, '', `${where} must be a block, not ${JSON.stringify(entry.value)}`);
  assert.ok(entry.children.length > 0, `${where} is empty`);
  return entry.children;
}

function unquote(value) {
  const m = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
  return m ? m[1] : value;
}

// compose text -> Map service name -> Map key -> { value, children }.
function parseCompose(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*#/.test(l))
    .map(stripComment)
    .filter((l) => l.trim() !== '');
  for (const l of lines) assert.ok(!/^[ ]*\t/.test(l), `compose: a tab in the indentation: ${JSON.stringify(l)}`);
  const top = mapping(lines, 0, 'compose');
  for (const k of top.keys()) assert.ok(TOP_LEVEL_KEYS.includes(k), `compose: top-level key ${k} is not modelled by this test`);
  const services = new Map();
  for (const [name, entry] of mapping(block(top.get('services'), 'services:'), 2, 'services')) {
    const keys = mapping(block(entry, `service ${name}`), 4, `service ${name}`);
    for (const k of keys.keys()) assert.ok(SERVICE_KEYS.includes(k), `${name}: key ${k} is not modelled by this test`);
    services.set(name, keys);
  }
  return services;
}

// The build a service names: the short form `build: <dir>` or a block with a
// context. null for an image-only service.
function buildOf(name, keys) {
  const entry = keys.get('build');
  if (!entry) return null;
  let context;
  let dockerfile = 'Dockerfile';
  let args = [];
  if (entry.value !== '') {
    context = unquote(entry.value);
  } else {
    const build = mapping(block(entry, `${name}: build`), 6, `${name}: build`);
    for (const k of build.keys()) assert.ok(BUILD_KEYS.includes(k), `${name}: build key ${k} is not modelled by this test`);
    assert.ok(build.has('context'), `${name}: build must name a context`);
    context = unquote(build.get('context').value);
    if (build.has('dockerfile')) dockerfile = unquote(build.get('dockerfile').value);
    args = entry.children;
  }
  assert.match(context, /^\.\/[A-Za-z0-9_./-]+$/, `${name}: build context ${context} must be a ./ path in this repo`);
  assert.match(dockerfile, /^[A-Za-z0-9_.-]+$/, `${name}: dockerfile ${dockerfile} must be a file name in the context`);
  const dir = path.posix.normalize(context);
  assert.ok(!dir.startsWith('..'), `${name}: build context ${context} leaves the repo`);
  return { dir, dockerfile: path.posix.join(dir, dockerfile), args };
}

// Dockerfile instructions, comments dropped and continuation lines joined.
function instructions(text) {
  const joined = text.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\\\n/g, ' ');
  return joined.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(\S+)\s*(.*)$/.exec(l);
    return { op: m[1].toUpperCase(), rest: m[2] };
  });
}

// The repo tree as the checks read it; a fixture passes its own.
const repoTree = {
  read: (rel) => read(path.resolve(REPO_ROOT, rel)),
  exists: (rel) => fs.existsSync(path.resolve(REPO_ROOT, rel)),
};

function services(text) {
  return [...parseCompose(text)].map(([name, keys]) => ({ name, keys, build: buildOf(name, keys) }));
}

function checkImages(text) {
  const all = services(text);
  for (const { name, keys, build } of all) {
    assert.ok(keys.has('image') || build, `${name}: names neither an image nor a build`);
    if (!keys.has('image')) continue;
    const image = unquote(keys.get('image').value);
    assert.match(image, PINNED_IMAGE, `${name}: image ${image} must carry an exact x.y.z version or a sha256 digest`);
    assert.ok(/:\d|@sha256:/.test(image), `${name}: image ${image} names no version or digest`);
  }
}

function checkFroms(text, tree) {
  const files = new Set(services(text).filter((s) => s.build).map((s) => s.build.dockerfile));
  for (const file of files) {
    const stages = [];
    for (const { op, rest } of instructions(tree.read(file))) {
      if (op !== 'FROM') continue;
      const m = /^(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i.exec(rest);
      assert.ok(m, `${file}: unreadable FROM ${rest}`);
      if (!stages.includes(m[1])) {
        assert.match(m[1], PINNED_IMAGE, `${file}: FROM ${m[1]} must carry an exact x.y.z version or a sha256 digest`);
        assert.ok(/:\d|@sha256:/.test(m[1]), `${file}: FROM ${m[1]} names no version or digest`);
      }
      if (m[2]) stages.push(m[2]);
    }
  }
  return files;
}

function checkSecrets(text, tree) {
  for (const { name, build } of services(text)) {
    if (!build) continue;
    for (const line of build.args) {
      assert.doesNotMatch(line, SECRET_NAME, `${name}: a build arg must not carry a secret: ${line.trim()}`);
    }
    for (const { op, rest } of instructions(tree.read(build.dockerfile))) {
      if (op === 'ARG' || op === 'ENV') {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
        assert.ok(m, `${build.dockerfile}: unreadable ${op} ${rest}`);
        assert.doesNotMatch(m[1], SECRET_NAME, `${build.dockerfile}: ${op} ${m[1]} must not carry a secret`);
      }
      if (op === 'COPY' || op === 'ADD') {
        const sources = rest.split(/\s+/).filter((w) => !w.startsWith('--')).slice(0, -1);
        for (const source of sources) {
          assert.doesNotMatch(source, /(^|\/)(secrets|certs)(\/|$)|\.pem$|\.key$|(^|\/)\.env/, `${build.dockerfile}: ${op} ${source} copies secret material`);
          if (source === '.' || source === './') {
            const ignore = path.posix.join(build.dir, '.dockerignore');
            assert.ok(tree.exists(ignore), `${build.dockerfile} copies its whole context, so ${ignore} must exist`);
            const patterns = tree.read(ignore).split('\n').map((l) => l.trim());
            for (const p of ['.env', '.env.*']) {
              assert.ok(patterns.includes(p), `${ignore} must exclude ${p}: ${build.dockerfile} copies its whole context`);
            }
          }
        }
      }
    }
  }
}

// Limits are read only from deploy.resources.limits, never from
// reservations or anywhere else under deploy.
function checkLimits(text) {
  for (const { name, keys } of services(text)) {
    const deploy = mapping(block(keys.get('deploy'), `${name}: deploy`), 6, `${name}: deploy`);
    const resources = mapping(block(deploy.get('resources'), `${name}: deploy.resources`), 8, `${name}: deploy.resources`);
    const limits = mapping(block(resources.get('limits'), `${name}: deploy.resources.limits`), 10, `${name}: deploy.resources.limits`);
    assert.ok(limits.has('cpus'), `${name}: limits.cpus is missing`);
    assert.match(unquote(limits.get('cpus').value), /^\d+(\.\d+)?$/, `${name}: limits.cpus is not a number`);
    assert.ok(limits.has('memory'), `${name}: limits.memory is missing`);
    assert.match(unquote(limits.get('memory').value), /^\d+[kmg]$/, `${name}: limits.memory is not a size`);
  }
}

// True when the arguments of an adduser/useradd name a uid that is not a
// plain non-zero number, or allow a non-unique uid (-o), in any spelling:
// separate words, a combined short-flag cluster (-Du0, -ou 0), quotes or
// --uid=0. Any uid option it cannot read as a non-zero number counts as unsafe.
function createsUnsafeUid(words) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let value = null;
    if (/^--(non-unique)$/.test(w)) return true;
    if (/^--uid(=|$)/.test(w)) {
      value = w.includes('=') ? w.slice(w.indexOf('=') + 1) : words[i + 1];
    } else if (/^-[A-Za-z]/.test(w) && !w.startsWith('--')) {
      const flags = w.slice(1);
      const u = flags.indexOf('u');
      const o = flags.indexOf('o');
      if (o >= 0 && (u < 0 || o < u)) return true;
      if (u >= 0) value = flags.slice(u + 1) !== '' ? flags.slice(u + 1) : words[i + 1];
    }
    if (value !== null && !/^0*[1-9]\d*$/.test(value ?? '')) return true;
  }
  return false;
}

// The words of each shell command in a RUN: quotes and backslashes dropped,
// then split at && || ; | ( ) and backticks, so a command inside sh -c "..."
// or $(...) reads as a command of its own, and an exec-form list as words.
function shellCommands(run) {
  return run.replace(/["'\\]/g, '').split(/&&|\|\||[;|()`\n]/)
    .map((c) => c.split(/[\s,[\]]+/).filter(Boolean));
}

// True when a word or path names the user database: a component passwd,
// shadow, group or gshadow (or its - backup), the etc directory itself (cd
// /etc, COPY x /etc/), or a glob directly under etc.
const USER_DATABASE = /^(passwd|shadow|group|gshadow)-?$/;
function namesUserDatabase(word) {
  const parts = word.split('/');
  return parts.some((p, i) => USER_DATABASE.test(p)
    || (p === 'etc' && (parts.slice(i + 1).every((q) => q === '') || /[*?{\]]/.test(parts[i + 1]))));
}

// True when a stage instruction may rewrite the user database: a RUN that
// names it, or a COPY/ADD whose source names it or whose destination,
// resolved against the stage's WORKDIR, is /, /etc or a database file. A
// destination it cannot resolve (a variable, an exec-form list, a relative
// path before any WORKDIR) counts as a rewrite.
function rewritesUserDatabase(op, workdir) {
  if (op.op === 'RUN') return shellCommands(op.rest).some((words) => words.some(namesUserDatabase));
  if (op.op !== 'COPY' && op.op !== 'ADD') return false;
  if (/^\s*\[/.test(op.rest)) return true;
  const words = op.rest.split(/\s+/).filter((w) => w && !w.startsWith('--'));
  if (words.length < 2 || words.some((w) => w.includes('$'))) return true;
  if (words.slice(0, -1).some(namesUserDatabase)) return true;
  const dest = words[words.length - 1];
  if (!dest.startsWith('/') && workdir === null) return true;
  const resolved = path.posix.normalize(dest.startsWith('/') ? dest : `${workdir}/${dest}`);
  return resolved === '/' || namesUserDatabase(resolved);
}

// A Dockerfile USER passes when it is a numeric non-root uid, or a name
// other than root that the final stage creates with adduser or useradd,
// where every adduser/useradd naming it leaves out uid 0 and -o, and the
// stage builds on no earlier stage, runs no deluser, userdel or usermod,
// and rewrites no user database file.
function dockerUserIsNonRoot(user, stageOps, earlierStages) {
  if (NUMERIC_NON_ROOT.test(user)) return true;
  const m = /^([a-z_][a-z0-9_-]*)(?::([a-z_][a-z0-9_-]*|0*[1-9]\d*))?$/.exec(user);
  if (!m || m[1] === 'root' || m[2] === 'root') return false;
  const from = /^(?:--platform=\S+\s+)?(\S+)/.exec(stageOps[0].rest);
  if (!from || earlierStages.includes(from[1].toLowerCase())) return false;
  let workdir = null;
  let created = false;
  for (const o of stageOps) {
    if (o.op === 'WORKDIR') {
      const dir = o.rest.trim();
      workdir = dir.includes('$') || (!dir.startsWith('/') && workdir === null) ? null
        : path.posix.normalize(dir.startsWith('/') ? dir : `${workdir}/${dir}`);
    }
    if (rewritesUserDatabase(o, workdir)) return false;
    if (o.op !== 'RUN') continue;
    for (const words of shellCommands(o.rest)) {
      for (let i = 0; i < words.length; i++) {
        if (/deluser|userdel|usermod/.test(words[i])) return false;
        if (!/adduser|useradd/.test(words[i])) continue;
        if (!/^(\S*\/)?(adduser|useradd)$/.test(words[i])) return false;
        const args = words.slice(i + 1);
        if (!args.includes(m[1])) continue;
        if (createsUnsafeUid(args)) return false;
        created = true;
      }
    }
  }
  return created;
}

function checkPrivilege(text, tree) {
  for (const { name, keys, build } of services(text)) {
    if (OFFICIAL_IMAGE_SERVICES.includes(name)) {
      assert.equal(build, null, `${name} is built from this repo, so it cannot be exempt`);
      continue;
    }
    assert.equal(keys.get('read_only')?.value, 'true', `${name}: read_only: true is missing`);
    assert.equal(keys.get('cap_drop')?.value, '["ALL"]', `${name}: cap_drop: ["ALL"] is missing`);
    if (keys.has('user')) {
      const user = unquote(keys.get('user').value);
      assert.match(user, NUMERIC_NON_ROOT, `${name}: user ${JSON.stringify(user)} is not a numeric non-root uid`);
      continue;
    }
    assert.ok(build, `${name}: runs an image this repo does not build and sets no user:, so it runs as the image's default user`);
    // The final stage is what compose.prod.yml runs (build: takes no target:).
    const ops = instructions(tree.read(build.dockerfile));
    const start = ops.map((o) => o.op).lastIndexOf('FROM');
    const stage = ops.slice(start);
    const earlierStages = ops.slice(0, start).filter((o) => o.op === 'FROM')
      .map((o) => /\s+AS\s+(\S+)\s*$/i.exec(o.rest)?.[1].toLowerCase()).filter(Boolean);
    const users = stage.filter((o) => o.op === 'USER');
    assert.ok(users.length > 0, `${name}: neither compose.prod.yml user: nor the final stage of ${build.dockerfile} sets a user, so it runs as root`);
    const user = users[users.length - 1].rest;
    assert.ok(dockerUserIsNonRoot(user, stage, earlierStages),`${name}: the final stage of ${build.dockerfile} runs as ${user}, which is not shown to be non-root`);
  }
}

function checkAll(text, tree) {
  checkImages(text);
  checkFroms(text, tree);
  checkSecrets(text, tree);
  checkLimits(text);
  checkPrivilege(text, tree);
}

test('RNF014 C1: every compose.prod.yml image is pinned by version or digest', () => {
  checkImages(read(COMPOSE_PROD));
});

test('RNF014 C1: every FROM in a production Dockerfile is pinned, or names an earlier stage', () => {
  assert.ok(checkFroms(read(COMPOSE_PROD), repoTree).size > 0, 'compose.prod.yml must build at least one image');
});

test('RNF014 C2: no secret is baked into a production image', () => {
  checkSecrets(read(COMPOSE_PROD), repoTree);
});

test('RNF014 C3: every compose.prod.yml service declares CPU and memory limits', () => {
  checkLimits(read(COMPOSE_PROD));
});

test('RNF014 C3: every service but the official-image data stores runs read_only, with cap_drop ALL and a non-root user', () => {
  const parsed = parseCompose(read(COMPOSE_PROD));
  for (const name of OFFICIAL_IMAGE_SERVICES) {
    assert.ok(parsed.has(name), `${name} is listed as an official-image service but compose.prod.yml has none`);
  }
  checkPrivilege(read(COMPOSE_PROD), repoTree);
});

test('RNF014 C7: the backend and both workers require a ready ReadinessReport and wait for the Foundation job', () => {
  const parsed = parseCompose(read(COMPOSE_PROD));
  for (const name of ['backend', 'worker', 'neo4j-projection-worker']) {
    const service = parsed.get(name);
    assert.ok(service, `compose.prod.yml must define ${name}`);
    const env = mapping(block(service.get('environment'), `${name}: environment`), 6, `${name}: environment`);
    assert.match(unquote(env.get('FOUNDATION_READINESS_REQUIRED')?.value ?? ''), /^(true|1)$/, `${name} must set FOUNDATION_READINESS_REQUIRED: "true"`);
    const deps = mapping(block(service.get('depends_on'), `${name}: depends_on`), 6, `${name}: depends_on`);
    assert.ok(deps.has('foundation'), `${name} must depend on foundation`);
    const foundation = mapping(block(deps.get('foundation'), `${name}: depends_on.foundation`), 8, `${name}: depends_on.foundation`);
    assert.equal(foundation.get('condition')?.value, 'service_completed_successfully', `${name} must wait for foundation to complete successfully`);
  }
});

// Fixtures: a minimal stack that passes, and one planted bypass per case.
const FIXTURE_DOCKERFILE = 'FROM node:22.23.4-alpine\nRUN addgroup -S app && adduser -S app -G app\nUSER app\n';
function fixtureTree(files = {}) {
  const all = { 'app/Dockerfile': FIXTURE_DOCKERFILE, ...files };
  return { read: (rel) => all[rel], exists: (rel) => rel in all };
}
const LIMITS = '    deploy:\n      resources:\n        limits:\n          cpus: "1"\n          memory: 1g\n';
const HARDENED = '    read_only: true\n    cap_drop: ["ALL"]\n';
const REDIS = `  redis:\n    image: redis:7.4.11-alpine\n${LIMITS}`;
const APP = `  app:\n    build:\n      context: ./app\n      dockerfile: Dockerfile\n${HARDENED}${LIMITS}`;
const fixture = (...services) => `name: fixture\n\nservices:\n${services.join('\n')}\nvolumes:\n  data:\n`;

test('RNF014 fixtures: the minimal hardened stack passes every check', () => {
  checkAll(fixture(REDIS, APP), fixtureTree());
  checkAll(fixture(REDIS, `  app:\n    image: example/app:1.2.3\n    user: "10001:10001"\n${HARDENED}${LIMITS}`), fixtureTree());
});

test('RNF014 refuses bypass 1: a service name with an underscore, dot, capital, quote or trailing comment', () => {
  for (const header of ['  bad_name:', '  bad.name:', '  BadName:', '  bad-name: # a comment']) {
    assert.throws(() => checkAll(fixture(REDIS, APP, `${header}\n    image: busybox:latest\n`), fixtureTree()), /busybox:latest must carry/, header);
  }
  assert.throws(() => checkAll(fixture(REDIS, APP, '  "quoted":\n    image: busybox:latest\n'), fixtureTree()), /unreadable key line/);
});

test('RNF014 refuses bypass 2: user 0:0 in single quotes, or an empty user', () => {
  for (const user of ["'0:0'", '""', "''", '"0"', 'root']) {
    assert.throws(() => checkAll(fixture(REDIS, `${APP}    user: ${user}\n`), fixtureTree()), /is not a numeric non-root uid/, user);
  }
});

test('RNF014 refuses bypass 3: a user from a variable, cap_add, privileged, a Dockerfile USER not shown non-root', () => {
  assert.throws(() => checkAll(fixture(REDIS, `${APP}    user: "\${APP_UID:-0}"\n`), fixtureTree()), /is not a numeric non-root uid/);
  assert.throws(() => checkAll(fixture(REDIS, `${APP}    cap_add: ["SYS_ADMIN"]\n`), fixtureTree()), /key cap_add is not modelled/);
  assert.throws(() => checkAll(fixture(REDIS, `${APP}    privileged: true\n`), fixtureTree()), /key privileged is not modelled/);
  assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree({ 'app/Dockerfile': 'FROM node:22.23.4-alpine\nARG U=0\nUSER ${U}\n' })), /is not shown to be non-root/);
  assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree({ 'app/Dockerfile': 'FROM node:22.23.4-alpine\nRUN adduser -u0 app\nUSER app\n' })), /is not shown to be non-root/);
  assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree({ 'app/Dockerfile': 'FROM node:22.23.4-alpine\nRUN adduser -S app && usermod -o -u 0 app\nUSER app\n' })), /is not shown to be non-root/);
});

test('RNF014 refuses bypass 3 in every uid-0 spelling and a rewritten passwd', () => {
  const dockerfile = (run) => ({ 'app/Dockerfile': `FROM node:22.23.4-alpine\nRUN ${run}\nUSER app\n` });
  for (const run of ['adduser -Du0 app', 'adduser -u "0" app', 'useradd -ou 0 app', 'adduser -D -u 0 app', 'useradd -o -u 1000 app', 'adduser --uid=0 app', 'adduser -u ${U} app', 'adduser -S app && sed -i s/app:x:100/app:x:0/ /etc/passwd']) {
    assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree(dockerfile(run))), /is not shown to be non-root/, run);
  }
  checkAll(fixture(REDIS, APP), fixtureTree(dockerfile('adduser -D -u 1000 app')));
  checkAll(fixture(REDIS, APP), fixtureTree(dockerfile('adduser -S -G root app')));
});

test('RNF014 refuses bypass 3 when any adduser of the user is unsafe, or the user is deleted', () => {
  const stage = (body) => ({ 'app/Dockerfile': `FROM node:22.23.4-alpine\n${body}USER app\n` });
  for (const body of [
    'RUN adduser -S app\nRUN adduser -D -u 0 app\n',
    'RUN adduser -S app && deluser app && adduser -u 0 -o app\n',
    'RUN adduser -S app\nRUN deluser app && adduser -D -u 0 app\n',
    'RUN adduser -S app && sh -c "deluser app; adduser -u 0 app"\n',
    'RUN adduser -S app && sh -c "adduser -u 0 app"\n',
    'RUN adduser -S app && userdel app\n',
    'RUN adduser -S app\nRUN ["adduser", "-u", "0", "app"]\n',
  ]) {
    assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree(stage(body))), /is not shown to be non-root/, body);
  }
  checkAll(fixture(REDIS, APP), fixtureTree(stage('RUN addgroup -S app && adduser -D -g "u 0" -G app app\n')));
});

test('RNF014 refuses bypass 3 through a user database rewritten by COPY, ADD, a doubled slash, a cd into /etc or a glob', () => {
  const stage = (body) => ({ 'app/Dockerfile': `FROM node:22.23.4-alpine\nRUN adduser -S app\n${body}USER app\n` });
  for (const body of [
    'COPY passwd /etc/passwd\n',
    'COPY --from=builder /etc/passwd /etc/\n',
    'ADD rootfs/ /\n',
    'WORKDIR /app\nCOPY users ../etc/\n',
    'WORKDIR /etc\nCOPY users .\n',
    'COPY users ./\n',
    'RUN sed -i s/x:100:/x:0:/ /etc//passwd\n',
    'RUN cd /etc && sed -i s/x:100:/x:0:/ passwd\n',
    'RUN cd /etc && sed -i s/x:100:/x:0:/ pass""wd\n',
    'RUN sed -i s/x:100:/x:0:/ /etc/pass*\n',
  ]) {
    assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree(stage(body))), /is not shown to be non-root/, body);
  }
  checkAll(fixture(REDIS, APP), fixtureTree(stage('WORKDIR /app\nCOPY src/ .\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\nRUN mkdir -p /etc/tsa/certs\n')));
});

test('RNF014 refuses bypass 3 from a final stage built on an earlier stage', () => {
  const dockerfile = 'FROM node:22.23.4-alpine AS base\nRUN adduser -S app && sed -i s/x:100:/x:0:/ /etc/passwd\nFROM base\nRUN adduser -S app || true\nUSER app\n';
  assert.throws(() => checkAll(fixture(REDIS, APP), fixtureTree({ 'app/Dockerfile': dockerfile })), /is not shown to be non-root/);
});

test('RNF014 refuses a line indented under a key that already has a value', () => {
  assert.throws(() => checkAll(fixture(REDIS, `${APP}    user: "10001"\n      extra: 1\n`), fixtureTree()), /already has a value/);
});

test('RNF014 refuses bypass 4: cpus and memory under reservations only', () => {
  const reserved = '    deploy:\n      resources:\n        reservations:\n          cpus: "1"\n          memory: 1g\n';
  assert.throws(() => checkAll(fixture(REDIS, `  app:\n    build:\n      context: ./app\n${HARDENED}${reserved}`), fixtureTree()), /deploy\.resources\.limits is missing/);
});

test('RNF014 refuses bypass 5: an image-only service outside the exempt data stores', () => {
  assert.throws(() => checkAll(fixture(REDIS, `  extra:\n    image: example/extra:1.2.3\n${LIMITS}`), fixtureTree()), /extra: read_only: true is missing/);
  assert.throws(() => checkAll(fixture(REDIS, `  extra:\n    image: example/extra:1.2.3\n${HARDENED}${LIMITS}`), fixtureTree()), /sets no user:/);
});

test('RNF014 refuses bypass 6: the short form build: ./dir', () => {
  const short = `  app:\n    build: ./app\n${HARDENED}${LIMITS}`;
  checkAll(fixture(REDIS, short), fixtureTree());
  assert.throws(() => checkAll(fixture(REDIS, short), fixtureTree({ 'app/Dockerfile': 'FROM node:latest\nRUN adduser -S app\nUSER app\n' })), /FROM node:latest must carry/);
  assert.throws(() => checkAll(fixture(REDIS, short), fixtureTree({ 'app/Dockerfile': 'FROM node:22.23.4-alpine\n' })), /sets a user, so it runs as root/);
});
