#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports', 'system-audit');
const BACKEND_DIR = 'api/backend';
const FRONTEND_DIR = 'frontend';

function nowIso() {
  return new Date().toISOString();
}

function timestampForFile() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walkFiles(dirPath, result = []) {
  if (!fs.existsSync(dirPath)) {
    return result;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) {
        continue;
      }
      walkFiles(fullPath, result);
      continue;
    }
    result.push(fullPath);
  }

  return result;
}

function toRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function runCommand(command, args, options = {}) {
  const startedAt = Date.now();
  const cmdText = [command, ...args].join(' ');

  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    shell: true,
    encoding: 'utf8',
    timeout: options.timeoutMs || 0,
    maxBuffer: 1024 * 1024 * 20
  });

  const durationMs = Date.now() - startedAt;
  const status = result.status === 0 ? 'PASS' : 'FAIL';

  return {
    status,
    command: cmdText,
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : null
  };
}

function extractFunctionNames(content) {
  const names = new Set();

  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g,
    /\bexport\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      names.add(match[1]);
    }
  }

  return names;
}

function auditFunctionCoverage() {
  const sourceRoots = [
    path.join(ROOT_DIR, BACKEND_DIR, 'src'),
    path.join(ROOT_DIR, FRONTEND_DIR, 'src')
  ];

  const testRoots = [
    path.join(ROOT_DIR, BACKEND_DIR, 'tests'),
    path.join(ROOT_DIR, FRONTEND_DIR, 'src')
  ];

  const sourceFiles = sourceRoots
    .flatMap((dir) => walkFiles(dir))
    .filter((filePath) => /\.(js|jsx|ts|tsx)$/.test(filePath));

  const testFiles = testRoots
    .flatMap((dir) => walkFiles(dir))
    .filter((filePath) => /(test|spec)\.(js|jsx|ts|tsx)$/.test(filePath));

  const functions = [];
  for (const sourceFile of sourceFiles) {
    const content = fs.readFileSync(sourceFile, 'utf8');
    const names = extractFunctionNames(content);
    for (const functionName of names) {
      if (functionName.length < 3) {
        continue;
      }
      functions.push({ file: toRelative(sourceFile), functionName });
    }
  }

  const uniqueFunctions = [];
  const seen = new Set();
  for (const entry of functions) {
    const key = `${entry.file}:${entry.functionName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueFunctions.push(entry);
  }

  const testContents = testFiles.map((filePath) => ({
    file: toRelative(filePath),
    content: fs.readFileSync(filePath, 'utf8')
  }));

  const uncovered = [];
  const covered = [];

  for (const fnEntry of uniqueFunctions) {
    const regex = new RegExp(`\\b${fnEntry.functionName}\\b`);
    const foundIn = [];

    for (const testFile of testContents) {
      if (regex.test(testFile.content)) {
        foundIn.push(testFile.file);
      }
    }

    if (foundIn.length > 0) {
      covered.push({ ...fnEntry, testFiles: foundIn });
    } else {
      uncovered.push(fnEntry);
    }
  }

  const total = uniqueFunctions.length;
  const coveredCount = covered.length;
  const uncoveredCount = uncovered.length;
  const coveragePct = total > 0 ? Number(((coveredCount / total) * 100).toFixed(2)) : 0;

  return {
    sourceFiles: sourceFiles.map(toRelative),
    testFiles: testFiles.map(toRelative),
    totalFunctions: total,
    coveredFunctions: coveredCount,
    uncoveredFunctions: uncoveredCount,
    coveragePct,
    uncoveredSample: uncovered.slice(0, 200)
  };
}

function runAudit() {
  const startedAtIso = nowIso();
  const checks = [];

  const registerCheck = (name, run, options = {}) => {
    const startedAt = Date.now();
    try {
      const output = run();
      const durationMs = Date.now() - startedAt;
      const status = output?.status || 'PASS';
      checks.push({
        name,
        required: options.required !== false,
        status,
        durationMs,
        details: output
      });
    } catch (error) {
      checks.push({
        name,
        required: options.required !== false,
        status: 'FAIL',
        durationMs: Date.now() - startedAt,
        details: {
          message: error.message,
          stack: error.stack
        }
      });
    }
  };

  registerCheck('Estrutura mínima do workspace', () => {
    const requiredPaths = [BACKEND_DIR, FRONTEND_DIR, 'scripts', 'README.md'];
    const missing = requiredPaths.filter((item) => !fs.existsSync(path.join(ROOT_DIR, item)));
    return {
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      requiredPaths,
      missing
    };
  });

  registerCheck('Scripts de auditoria existentes', () => {
    const requiredScripts = [
      'scripts/system-audit-full.js',
      `${BACKEND_DIR}/scripts/audit-database.js`
    ];

    const missing = requiredScripts.filter((file) => !fs.existsSync(path.join(ROOT_DIR, file)));
    return {
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      requiredScripts,
      missing
    };
  });

  registerCheck('Sanitização permanente do repositório', () => {
    const tracked = runCommand('git', ['ls-files']);
    const trackedFiles = tracked.stdout.split(/\r?\n/).filter(Boolean);
    const forbiddenTracked = trackedFiles.filter((file) =>
      /(^|\/)(playwright-report|test-results|validation-evidence)(\/|$)|\.(patch|bak|backup)$/i.test(file)
    );
    const productionFiles = walkFiles(path.join(ROOT_DIR, FRONTEND_DIR, 'src'))
      .concat(walkFiles(path.join(ROOT_DIR, BACKEND_DIR, 'src')))
      .filter((file) => /\.(js|jsx|ts|tsx)$/.test(file));
    const forbiddenPatterns = [
      /FABRY_MOCK_|mergeDisease(?:Phenotypes|Biomarkers)WithFabry|shouldInjectFabryMock/,
      /34\.60\.170\.17/,
    ];
    const forbiddenReferences = [];
    for (const file of productionFiles) {
      const content = fs.readFileSync(file, 'utf8');
      forbiddenPatterns.forEach((pattern) => {
        if (pattern.test(content)) forbiddenReferences.push({ file: toRelative(file), pattern: String(pattern) });
      });
    }
    const changedProduction = runCommand('git', ['diff', '--unified=0', 'HEAD', '--', `${FRONTEND_DIR}/src`, `${BACKEND_DIR}/src`]);
    const introducedDebug = changedProduction.stdout
      .split(/\r?\n/)
      .filter((line) => /^\+(?!\+\+)/.test(line) && /\[DEBUG\]/.test(line));
    return {
      status: tracked.status === 'PASS' && forbiddenTracked.length === 0 && forbiddenReferences.length === 0 && introducedDebug.length === 0 ? 'PASS' : 'FAIL',
      forbiddenTracked,
      forbiddenReferences,
      introducedDebug,
    };
  });

  registerCheck('Política de zero mocks', () => {
    return runCommand('node', ['scripts/audit-zero-mocks.js']);
  });

  registerCheck('Backend real-services test:ci', () => {
    return runCommand('npm', ['run', 'test:stack:backend']);
  });

  registerCheck('Frontend typecheck:core', () => {
    return runCommand('npm', ['--prefix', FRONTEND_DIR, 'run', 'typecheck:core']);
  }, { required: false });

  registerCheck('Frontend build', () => {
    return runCommand('npm', ['--prefix', FRONTEND_DIR, 'run', 'build']);
  });

  registerCheck('Cobertura de funções por testes (análise estática)', () => {
    const coverage = auditFunctionCoverage();
    const status = coverage.uncoveredFunctions === 0 ? 'PASS' : 'WARN';
    return {
      status,
      ...coverage
    };
  }, { required: false });

  const finishedAtIso = nowIso();
  const requiredFailures = checks.filter((check) => check.required && check.status === 'FAIL');
  const overallStatus = requiredFailures.length === 0 ? 'PASS' : 'FAIL';

  const report = {
    name: 'BioAvanceD - Auditoria Completa do Sistema',
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    overallStatus,
    checks
  };

  ensureDir(REPORTS_DIR);
  const stamp = timestampForFile();
  const jsonPath = path.join(REPORTS_DIR, `audit-complete-${stamp}.json`);
  const txtPath = path.join(REPORTS_DIR, `audit-complete-${stamp}.txt`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const lines = [];
  lines.push('BIOAVANCED - AUDITORIA COMPLETA DO SISTEMA');
  lines.push('='.repeat(72));
  lines.push(`Início: ${startedAtIso}`);
  lines.push(`Fim: ${finishedAtIso}`);
  lines.push(`Status geral: ${overallStatus}`);
  lines.push('');

  checks.forEach((check, index) => {
    lines.push(`${index + 1}. ${check.name}`);
    lines.push(`   - status: ${check.status}`);
    lines.push(`   - obrigatório: ${check.required ? 'sim' : 'não'}`);
    lines.push(`   - duração: ${check.durationMs} ms`);

    if (check.details?.command) {
      lines.push(`   - comando: ${check.details.command}`);
      lines.push(`   - exitCode: ${String(check.details.exitCode)}`);
    }

    if (check.name.includes('Cobertura de funções')) {
      lines.push(`   - total de funções: ${check.details.totalFunctions}`);
      lines.push(`   - cobertas em testes: ${check.details.coveredFunctions}`);
      lines.push(`   - não cobertas: ${check.details.uncoveredFunctions}`);
      lines.push(`   - cobertura: ${check.details.coveragePct}%`);

      if (check.details.uncoveredSample.length > 0) {
        lines.push('   - exemplos não cobertos (até 20):');
        check.details.uncoveredSample.slice(0, 20).forEach((item) => {
          lines.push(`     • ${item.file} :: ${item.functionName}`);
        });
      }
    }

    if (check.details?.missing?.length) {
      lines.push(`   - faltando: ${check.details.missing.join(', ')}`);
    }

    if (check.details?.error) {
      lines.push(`   - erro: ${check.details.error}`);
    }

    lines.push('');
  });

  fs.writeFileSync(txtPath, lines.join('\n'), 'utf8');

  console.log('='.repeat(72));
  console.log('AUDITORIA COMPLETA FINALIZADA');
  console.log('='.repeat(72));
  console.log(`Status geral: ${overallStatus}`);
  console.log(`Relatório JSON: ${toRelative(jsonPath)}`);
  console.log(`Relatório TXT : ${toRelative(txtPath)}`);

  checks.forEach((check) => {
    console.log(`- [${check.status}] ${check.name}`);
  });

  process.exit(overallStatus === 'PASS' ? 0 : 1);
}

runAudit();
