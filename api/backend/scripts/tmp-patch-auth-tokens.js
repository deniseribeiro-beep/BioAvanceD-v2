#!/usr/bin/env node
/**
 * Patch integration/unit suites that mint JWT with non-UUID userID to use
 * Stage 2E auth.factory (UUID userAccountId + actorId).
 */
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.js$/.test(ent.name)) out.push(p);
  }
  return out;
}

const IMPORT_SNIPPET = `const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');
`;

const IMPORT_SNIPPET_UNIT = IMPORT_SNIPPET.replace("require('../factories/auth.factory')", "require('../../factories/auth.factory')")
  .replace("require('../factories/auth.factory')", "require('../../factories/auth.factory')");

function patchFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('jwt.sign') && !src.includes("qa-user-")) return false;
  if (src.includes('makeAuthToken')) return false;
  if (src.includes('factories/auth.factory')) return false;

  const rel = file.replace(/\\/g, '/');
  const isIntegration = rel.includes('/tests/integration/');
  const isUnit = rel.includes('/tests/unit/');
  if (!isIntegration && !isUnit) return false;

  const depth = isIntegration ? '../factories/auth.factory' : (
    rel.includes('/tests/unit/services/') || rel.includes('/tests/unit/controllers/') || rel.includes('/tests/unit/infrastructure/')
      ? '../../../factories/auth.factory'
      : '../../factories/auth.factory'
  );

  const importBlock = `const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('${depth}');
`;

  // Insert after last require of rbac.factory or db.factory if present
  if (src.includes("require('../factories/rbac.factory')") || src.includes('require("../factories/rbac.factory")')) {
    src = src.replace(
      /const \{[^}]*buildRbacCollections[^}]*\} = require\(['"]\.\.\/factories\/rbac\.factory['"]\);/,
      (m) => `${m}\n${importBlock}`,
    );
  } else if (src.includes("require('../factories/db.factory')")) {
    src = src.replace(
      /const \{[^}]*\} = require\(['"]\.\.\/factories\/db\.factory['"]\);/,
      (m) => `${m}\n${importBlock}`,
    );
  } else if (/^const request = require\('supertest'\);/m.test(src)) {
    src = src.replace(/^const request = require\('supertest'\);/m, (m) => `${m}\n${importBlock}`);
  } else {
    src = importBlock + src;
  }

  // Replace simple userIdFor
  src = src.replace(
    /function userIdFor\(accessType\) \{\s*return `qa-user-at\$\{accessType\}`;\s*\}/g,
    `function userIdFor(accessType) {\n  return userForAccessType(accessType).userAccountId;\n}`,
  );
  src = src.replace(
    /function userIdFor\(accessType\) \{\s*return 'qa-user-' \+ accessType;\s*\}/g,
    `function userIdFor(accessType) {\n  return userForAccessType(accessType).userAccountId;\n}`,
  );

  // Replace makeToken bodies that jwt.sign with qa-user
  src = src.replace(
    /function makeToken\(accessType = 4\) \{[\s\S]*?return jwt\.sign\([\s\S]*?\);\s*\}/g,
    `function makeToken(accessType = 4) {\n  return makeAuthToken(accessType);\n}`,
  );

  src = src.replace(
    /function makeTokenLegacyClaims\(accessType = 4\) \{[\s\S]*?return jwt\.sign\([\s\S]*?\);\s*\}/g,
    `function makeTokenLegacyClaims(accessType = 4) {\n  return makeLegacyClaimsToken(accessType);\n}`,
  );

  // Common literal userAccountIds
  src = src.replace(/userAccountId:\s*'qa-user-1'/g, "userAccountId: TEST_USER_ACCOUNT_IDS[4]");
  src = src.replace(/userAccountId:\s*'qa-admin-1'/g, "userAccountId: TEST_USER_ACCOUNT_IDS[4]");
  src = src.replace(/userAccountId:\s*'qa-coord-1'/g, "userAccountId: TEST_USER_ACCOUNT_IDS[3]");
  src = src.replace(/userAccountId:\s*'qa-user-legacy'/g, "userAccountId: TEST_USER_ACCOUNT_IDS.legacy");
  src = src.replace(/userID:\s*'qa-user-1'/g, `userID: TEST_USER_ACCOUNT_IDS[4]`);
  src = src.replace(/userID:\s*'qa-user-legacy'/g, `userID: TEST_USER_ACCOUNT_IDS.legacy`);

  // buildRbacCollections([...qa...]) left as-is if already rewritten ids; JWT still needs actorId via makeAuthToken

  fs.writeFileSync(file, src);
  return true;
}

const roots = [
  path.join(__dirname, '..', 'tests', 'integration'),
  path.join(__dirname, '..', 'tests', 'unit'),
];
let n = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    if (patchFile(file)) {
      n += 1;
      console.log('patched', path.relative(process.cwd(), file));
    }
  }
}
console.log('PATCHED', n);
