#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  'api/backend/src',
  'api/backend/tests/integration',
  'frontend/src',
  'frontend/playwright',
  'frontend/tests/e2e',
  'tests/e2e',
];
const ignored = new Set(['academico/inpi', 'node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results']);
const forbidden = [
  /\bvi\.mock\s*\(/,
  /\bvi\.(?:clearAllMocks|fn|spyOn)\s*\(/,
  /\bjest\.mock\s*\(/,
  /\.mockResolvedValue\b/,
  /\.mockRejectedValue\b/,
  /\.mockImplementation\b/,
  /\bpage\.route\s*\(/,
  /\broute\.fulfill\s*\(/,
  /\bapi-mocks\b/i,
  /\bmocked-jwt-token-admin\b/i,
  /\binjectSessionToken\b/,
  /\bcreateMockJwt\b/,
  /\bcreateAdminAuthContext\b/,
  /\bmockPatientsApi\b/,
  /\bmockWizardDomainApis\b/,
  /\bmockAuthVerifyKeepalive\b/,
  /\bcreateDbMock\b/,
  /\bcreateCollectionMock\b/,
  /\bmock(?:Db|DB|Coll|Collection|Database)\b/,
  /\bMOCK_[A-Z0-9_]*\b/,
  /\bmockMode\b/,
  /\buseMock\b/,
  /FABRY_MOCK_|mergeDisease(?:Phenotypes|Biomarkers)WithFabry|shouldInjectFabryMock/,
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  if (fs.statSync(directory).isFile()) {
    if (/\.(c?js|mjs|jsx|ts|tsx)$/.test(directory)) files.push(directory);
    return files;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if ([...ignored].some((item) => relative === item || relative.startsWith(`${item}/`) || entry.name === item)) continue;
    if (entry.isDirectory()) walk(absolute, files);
    else if (/\.(c?js|mjs|jsx|ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

const failures = [];
for (const scanRoot of scanRoots) {
  for (const file of walk(path.join(root, scanRoot))) {
    if (/\.mock\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) {
      failures.push(`${path.relative(root, file)}: forbidden mock test file`);
    }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      forbidden.forEach((pattern) => {
        if (pattern.test(line)) failures.push(`${path.relative(root, file)}:${index + 1}: ${pattern}`);
      });
    });
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Zero-mock policy satisfied.');
