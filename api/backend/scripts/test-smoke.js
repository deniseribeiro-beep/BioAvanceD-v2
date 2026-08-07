#!/usr/bin/env node
/**
 * #515: vitest's `--changed`/`related` flags never walk this repo's
 * CommonJS require() graph (not even one level deep), so
 * `vitest run --changed` is a no-op here. This script builds the
 * require() dependency graph itself (grep-based, BFS to full
 * transitive closure) and runs vitest only on the test files that
 * actually depend on what changed.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const base = process.argv[2] || process.env.SMOKE_BASE_REF || 'origin/main';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function changedFiles() {
  const tracked = git(['diff', '--name-only', '--relative', base])
    .split('\n')
    .filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])]
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.resolve(ROOT, f))
    .filter((f) => fs.existsSync(f));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveRequire(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // skip package/node_modules requires
  let resolved = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    resolved,
    `${resolved}.js`,
    path.join(resolved, 'index.js'),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function buildGraph(files) {
  // edges: file -> set of files it requires (dependencies)
  const deps = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const set = new Set();
    let match;
    REQUIRE_RE.lastIndex = 0;
    while ((match = REQUIRE_RE.exec(src))) {
      const resolved = resolveRequire(file, match[1]);
      if (resolved) set.add(resolved);
    }
    deps.set(file, set);
  }
  return deps;
}

function reverseGraph(deps) {
  const rev = new Map();
  for (const [file, targets] of deps) {
    for (const target of targets) {
      if (!rev.has(target)) rev.set(target, new Set());
      rev.get(target).add(file);
    }
  }
  return rev;
}

function affectedTestFiles(changed, allFiles, testFiles) {
  const rev = reverseGraph(buildGraph(allFiles));
  const affected = new Set();
  const queue = [...changed];
  const seen = new Set(changed);
  while (queue.length) {
    const current = queue.shift();
    if (testFiles.includes(current)) affected.add(current);
    const dependents = rev.get(current) || new Set();
    for (const dependent of dependents) {
      if (!seen.has(dependent)) {
        seen.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...affected];
}

function main() {
  const srcDir = path.join(ROOT, 'src');
  const testsDir = path.join(ROOT, 'tests');
  const allFiles = [...walk(srcDir), ...walk(testsDir)];
  const testFiles = allFiles.filter((f) => f.endsWith('.test.js'));

  const changed = changedFiles();
  if (changed.length === 0) {
    console.log('test:smoke: no changed .js files vs %s — nothing to run.', base);
    return;
  }

  const changedTestFiles = changed.filter((f) => testFiles.includes(f));
  const affected = new Set([
    ...changedTestFiles,
    ...affectedTestFiles(changed, allFiles, testFiles),
  ]);

  if (affected.size === 0) {
    console.log('test:smoke: no test files depend on the changed files — nothing to run.');
    return;
  }

  const MAX_SMOKE_FILES = 150; // beyond this the "cheap slice" premise no longer holds
  if (affected.size > MAX_SMOKE_FILES) {
    console.error(
      `test:smoke: ${affected.size} test files are affected relative to ${base} — ` +
        `too many for a cheap smoke pass (this usually means the base ref is stale, ` +
        `not that the change itself is broad). Run "npm run test:unit" instead.`,
    );
    process.exitCode = 1;
    return;
  }

  const relFiles = [...affected].map((f) => path.relative(ROOT, f));
  console.log(`test:smoke: running ${relFiles.length} affected test file(s):`);
  relFiles.forEach((f) => console.log(`  ${f}`));

  execFileSync(
    'npx',
    ['vitest', 'run', '--passWithNoTests', '--reporter=dot', ...relFiles],
    { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
}

main();
