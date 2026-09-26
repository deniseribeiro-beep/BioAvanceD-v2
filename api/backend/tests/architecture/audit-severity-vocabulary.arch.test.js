'use strict';

/**
 * #1237 — every severity literal handed to auditLogger.log (directly, or via
 * a controller's logAudit wrapper) must be in AuditEvent's vocabulary.
 *
 * dict-02 P1X-0330: AuditEvent.severity is "info, warning, error ou
 * critical", code, 1..1 Core. Log.js enforces exactly that, and
 * auditLogger.log catches the validation throw and only logs it -- so a call
 * site passing 'high' or 'medium' loses its audit row with no signal to the
 * caller. Seven sites did (sample WITHDRAW/RETURN, file replace and the three
 * file exports), and their unit tests pinned the bad value against a mocked
 * auditLogger that never validates.
 *
 * The allowed set is read off Log.js rather than repeated here, so the check
 * follows the model if the vocabulary ever changes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readStripped } = require('./helpers/strip-comments');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

function allowedSeverities() {
  const source = fs.readFileSync(path.join(BACKEND_ROOT, 'src/models/Log.js'), 'utf8');
  const match = source.match(/data\.severity\s*&&\s*!\[([^\]]+)\]\.includes\(data\.severity\)/);
  assert.ok(match, 'could not find the severity whitelist in src/models/Log.js');
  return match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
}

function trackedSourceFiles() {
  return execFileSync('git', ['ls-files', 'src'], { cwd: BACKEND_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.js'));
}

// Each call's argument text: from the opening parenthesis to its matching
// close. A regex to the next '});' would bleed into the following statement.
function callArguments(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function severityLiteralsPassedToAuditLogger() {
  const found = [];
  const callPattern = /\b(?:auditLogger\.log|logAudit)\s*\(/g;
  for (const file of trackedSourceFiles()) {
    const source = readStripped(fs, path.join(BACKEND_ROOT, file));
    let call;
    while ((call = callPattern.exec(source)) !== null) {
      const args = callArguments(source, call.index + call[0].length - 1);
      const severityPattern = /\bseverity\s*:\s*['"]([A-Za-z]+)['"]/g;
      let sev;
      while ((sev = severityPattern.exec(args)) !== null) {
        const line = source.slice(0, call.index).split('\n').length;
        found.push({ site: `${file}:${line}`, severity: sev[1] });
      }
    }
  }
  return found;
}

test('the scan finds the severity literals it is meant to check', () => {
  // Guards the patterns above: if they silently stop matching, the vocabulary
  // assertion below passes vacuously over an empty set (#797).
  const found = severityLiteralsPassedToAuditLogger();
  assert.ok(found.length >= 20, `expected at least 20 literal severities, found ${found.length}`);
  assert.deepStrictEqual(allowedSeverities(), ['info', 'warning', 'error', 'critical']);
});

test('every literal severity passed to auditLogger.log is in the AuditEvent vocabulary (#1237)', () => {
  const allowed = new Set(allowedSeverities());
  const offenders = severityLiteralsPassedToAuditLogger()
    .filter(({ severity }) => !allowed.has(severity))
    .map(({ site, severity }) => `${site} severity '${severity}'`);
  assert.deepStrictEqual(offenders, [], `Log.js rejects these and the audit row is dropped:\n${offenders.join('\n')}`);
});
