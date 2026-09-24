#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') walk(p, out);
    } else if (/\.js$/.test(ent.name)) out.push(p);
  }
  return out;
}

function authRequirePath(file) {
  const rel = file.replace(/\\/g, '/');
  if (rel.includes('/tests/integration/')) return '../factories/auth.factory';
  if (rel.includes('/tests/unit/services/') || rel.includes('/tests/unit/controllers/') || rel.includes('/tests/unit/infrastructure/')) {
    return '../../../factories/auth.factory';
  }
  return '../../factories/auth.factory';
}

const map = [
  [/['"]qa-user-at2['"]/g, 'TEST_USER_ACCOUNT_IDS[2]'],
  [/['"]qa-user-at3['"]/g, 'TEST_USER_ACCOUNT_IDS[3]'],
  [/['"]qa-user-at4['"]/g, 'TEST_USER_ACCOUNT_IDS[4]'],
  [/['"]qa-user-1['"]/g, 'TEST_USER_ACCOUNT_IDS[4]'],
  [/['"]qa-user-2['"]/g, 'TEST_USER_ACCOUNT_IDS[2]'],
  [/['"]qa-admin-1['"]/g, 'TEST_USER_ACCOUNT_IDS[4]'],
  [/['"]qa-coord-1['"]/g, 'TEST_USER_ACCOUNT_IDS[3]'],
  [/['"]qa-tecnico-1['"]/g, 'TEST_USER_ACCOUNT_IDS[2]'],
  [/['"]qa-tecnico-2['"]/g, 'TEST_USER_ACCOUNT_IDS[2]'],
  [/['"]qa-1['"]/g, 'TEST_USER_ACCOUNT_IDS[4]'],
  [/['"]qa-user-legacy['"]/g, 'TEST_USER_ACCOUNT_IDS.legacy'],
];

let n = 0;
for (const root of [path.join(__dirname, '..', 'tests', 'integration'), path.join(__dirname, '..', 'tests', 'unit')]) {
  for (const file of walk(root)) {
    let src = fs.readFileSync(file, 'utf8');
    const orig = src;

    src = src.replace(
      /function makeToken\(([^)]*)\) \{[\s\S]*?return jwt\.sign\([\s\S]*?\);\s*\}/g,
      (match, args) => {
        const def = (args.match(/accessType\s*=\s*(\d+)/) || [])[1] || '4';
        return `function makeToken(accessType = ${def}) {\n  return makeAuthToken(accessType);\n}`;
      },
    );

    for (const [re, rep] of map) src = src.replace(re, rep);

    if (src.includes('TEST_USER_ACCOUNT_IDS') && !src.includes('factories/auth.factory')) {
      const block = `const { makeAuthToken, makeLegacyClaimsToken, buildAuthenticatedCollections, userForAccessType, TEST_USER_ACCOUNT_IDS } = require('${authRequirePath(file)}');\n`;
      src = block + src;
    }

    if (src !== orig) {
      fs.writeFileSync(file, src);
      n += 1;
      console.log('updated', path.relative(process.cwd(), file));
    }
  }
}
console.log('UPDATED', n);
