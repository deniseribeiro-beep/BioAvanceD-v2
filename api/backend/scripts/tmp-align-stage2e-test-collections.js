#!/usr/bin/env node
/**
 * One-shot: rename legacy Mongo collection keys in test fakes to Stage 2E
 * canonical names (samples→specimens, patients→participants, users→userAccounts).
 * Skips topology/migration suites that intentionally assert legacy names.
 */
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'coverage') continue;
      walk(p, out);
    } else if (/\.(js|mjs|cjs)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

const SKIP_SUFFIXES = [
  path.join('unit', 'config', 'collections.test.js'),
  path.join('unit', 'foundation', 'mongoTopologyV2.test.js'),
  path.join('unit', 'foundation', 'userAccountIdentityMigrationV2.test.js'),
  path.join('architecture', 'mongo-canonical-topology.arch.test.js'),
];

function shouldSkip(file) {
  const norm = file.split(path.sep).join(path.sep);
  return SKIP_SUFFIXES.some((suffix) => norm.endsWith(suffix));
}

const FACTORY_FNS = [
  'createFakeCollection',
  'makeCollection',
  'createCollectionMock',
  'createStatefulCollection',
  'createCollection',
  'collection',
  'makeColl',
].join('|');

const replacements = [
  [new RegExp(`\\bsamples:\\s*(${FACTORY_FNS})\\b`, 'g'), 'specimens: $1'],
  [new RegExp(`\\bpatients:\\s*(${FACTORY_FNS})\\b`, 'g'), 'participants: $1'],
  [new RegExp(`\\busers:\\s*(${FACTORY_FNS})\\b`, 'g'), 'userAccounts: $1'],
  [/\bsamples:\s*(\{\s*findOne)/g, 'specimens: $1'],
  [/\bpatients:\s*(\{\s*findOne)/g, 'participants: $1'],
  [/\busers:\s*(\{\s*findOne)/g, 'userAccounts: $1'],
  [/\bsamples:\s*(\w*[Cc]ollection\w*)\b/g, 'specimens: $1'],
  [/\bpatients:\s*(\w*[Cc]ollection\w*)\b/g, 'participants: $1'],
  [/\busers:\s*(\w*[Cc]ollection\w*)\b/g, 'userAccounts: $1'],
  [/name !== ['"]samples['"]/g, "name !== 'specimens'"],
  [/name !== ['"]patients['"]/g, "name !== 'participants'"],
  [/name !== ['"]users['"]/g, "name !== 'userAccounts'"],
  [/name === ['"]samples['"]/g, "name === 'specimens'"],
  [/name === ['"]patients['"]/g, "name === 'participants'"],
  [/name === ['"]users['"]/g, "name === 'userAccounts'"],
  [/collection\(['"]samples['"]\)/g, "collection('specimens')"],
  [/collection\(['"]patients['"]\)/g, "collection('participants')"],
  [/collection\(['"]users['"]\)/g, "collection('userAccounts')"],
  [/collection\(['"]amostras['"]\)/g, "collection('specimens')"],
  [/makeCollection\(['"]samples['"]\)/g, "makeCollection('specimens')"],
  [/makeCollection\(['"]patients['"]\)/g, "makeCollection('participants')"],
  [/createFakeCollection\(['"]samples['"]\)/g, "createFakeCollection('specimens')"],
];

const root = path.join(__dirname, '..', 'tests');
const files = walk(root);
let changedFiles = 0;

for (const file of files) {
  if (shouldSkip(file)) continue;
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  for (const [re, rep] of replacements) {
    src = src.replace(re, rep);
  }
  if (src !== orig) {
    fs.writeFileSync(file, src);
    changedFiles += 1;
    console.log('updated', path.relative(process.cwd(), file));
  }
}

console.log('CHANGED', changedFiles);
