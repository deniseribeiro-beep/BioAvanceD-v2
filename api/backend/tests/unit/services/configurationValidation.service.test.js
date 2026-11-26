import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configurationValidationService = require('../../../src/services/configurationValidation.service');
const securityService = require('../../../src/services/security.service');
const retentionPolicyService = require('../../../src/services/retentionPolicy.service');
const sessionService = require('../../../src/services/session.service');
const auditLogger = require('../../../src/utils/auditLogger');
const ConfigurationValidationRunModel = require('../../../src/models/ConfigurationValidationRun');
const { INVARIANTS } = require('../../../src/governance/invariants');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RF014 AC3/AC4/AC6/AC7, RNF018 C3, RNF028 C5, CFG-005, CFG-008, RULE-015:
 * every security-configuration candidate passes a ConfigurationValidationRun
 * before activation; a failed one is refused, kept as a draft, and a broken
 * governance invariant is recorded as a violation attempt. Through
 * securityService.updateConfig against the fake db, which runs the real
 * filters, sorts and counts.
 */
const releasesOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationReleases).docs;
const runsOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationValidationRuns).docs;
const eventsOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationChangeEvents).docs;
const violationsOf = (db) => db.collection(CANONICAL_COLLECTIONS.invariantViolations).docs;
const req = { user: { userID: 'admin-1' }, headers: {} };

beforeEach(() => {
  vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(null);
  vi.spyOn(sessionService, 'revokeAllSessionsForPolicyChange').mockResolvedValue(0);
  vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
  vi.spyOn(auditLogger, 'log').mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());

describe('a valid change passes its run before it is activated', () => {
  it('records a passed run naming the release it activated, after proposed and approved events', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    const saved = await securityService.updateConfig(db, { session: { timeoutMinutes: 20 } }, initial, req);

    const [run] = runsOf(db);
    expect(run).toMatchObject({
      releaseId: saved.configurationReleaseId, status: 'passed',
      structuralResult: 'pass', semanticResult: 'pass', dependencyResult: 'pass', securityResult: 'pass',
    });
    expect(run.invariantResults.map((entry) => entry.invariantId)).toEqual(INVARIANTS.map((invariant) => invariant.invariantId));
    expect(run.invariantResults.every((entry) => entry.result === 'pass')).toBe(true);
    expect(run.reportUri).toMatch(new RegExp(`^urn:bioavanced:configuration-validation-run:${run.configurationValidationRunId}#sha256=[0-9a-f]{64}$`));
    expect(ConfigurationValidationRunModel.validate(run)).toEqual({ isValid: true, errors: [] });
    expect(eventsOf(db).filter((event) => event.releaseId === saved.configurationReleaseId).map((event) => event.changeType))
      .toEqual(['proposed', 'approved', 'activated']);
  });
});

describe('an invariant broken by a change is refused and recorded (RF014 AC6/AC7, CFG-008)', () => {
  it('422, the candidate stays a draft, the run fails the invariant, and a violation_attempted event names it', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await securityService.updateConfig(db, { session: { timeoutMinutes: 20 } }, initial, req);
    const before = await securityService.getConfig(db);

    await expect(securityService.updateConfig(db, { logging: { logAllActions: false } }, before, req))
      .rejects.toMatchObject({ statusCode: 422, violatedInvariants: ['INV-AUDIT-001'] });

    const draft = releasesOf(db).find((release) => release.status === 'draft');
    expect(draft).toMatchObject({ approvedBy: null, semanticVersion: '3.0.0-draft.1' });
    expect(draft.settings.logging.logAllActions).toBe(false);
    const run = runsOf(db).find((entry) => entry.releaseId === draft.configurationReleaseId);
    expect(run.status).toBe('failed');
    expect(run.invariantResults.find((entry) => entry.invariantId === 'INV-AUDIT-001')).toEqual({ invariantId: 'INV-AUDIT-001', result: 'fail', paths: ['logging.logAllActions'] });
    expect(eventsOf(db).filter((event) => event.releaseId === draft.configurationReleaseId).map((event) => event.changeType))
      .toEqual(['proposed', 'violation_attempted']);
    // RF019 AC1/AC4 (#1315): the broken invariant is an InvariantViolation,
    // correlated with the refused candidate and evidenced by its run.
    expect(violationsOf(db)).toEqual([expect.objectContaining({
      invariantViolationId: expect.any(String),
      invariantId: 'INV-AUDIT-001',
      sourceComponent: 'configurationValidation',
      outcome: 'block',
      evidenceUri: run.reportUri,
      correlationId: draft.configurationReleaseId,
      detectedAt: expect.any(Date),
    })]);

    // The configuration in force did not move.
    const after = await securityService.getConfig(db);
    expect(after.configurationReleaseId).toBe(before.configurationReleaseId);
    expect(after.logging.logAllActions).toBe(true);
    expect(releasesOf(db).filter((release) => release.status === 'active')).toHaveLength(1);
  });

  it('a key outside the profile catalog fails the structural gate and INV-SCOPE-001', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await expect(securityService.updateConfig(db, { session: { outboxEnabled: false } }, initial, req))
      .rejects.toMatchObject({
        statusCode: 422,
        violatedInvariants: ['INV-SCOPE-001'],
        violations: [{ invariantId: 'INV-SCOPE-001', fieldPath: 'session.outboxEnabled' }],
      });
    const [run] = runsOf(db);
    expect(run).toMatchObject({ structuralResult: 'fail', status: 'failed' });
    expect(run.invariantResults.find((entry) => entry.invariantId === 'INV-SCOPE-001').paths).toEqual(['session.outboxEnabled']);
  });

  it('a top-level key outside the policy groups fails the structural gate and INV-SCOPE-001, naming its fieldPath', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await securityService.updateConfig(db, { session: { timeoutMinutes: 20 } }, initial, req);
    const before = await securityService.getConfig(db);
    await expect(securityService.updateConfig(db, { outbox: { enabled: false } }, before, req))
      .rejects.toMatchObject({
        statusCode: 422,
        violatedInvariants: ['INV-SCOPE-001'],
        violations: [{ invariantId: 'INV-SCOPE-001', fieldPath: 'outbox' }],
      });
    const run = runsOf(db).find((entry) => entry.status === 'failed');
    expect(run).toMatchObject({ structuralResult: 'fail', status: 'failed' });
    expect(run.invariantResults.find((entry) => entry.invariantId === 'INV-SCOPE-001').paths).toEqual(['outbox']);
    // RNF018 AC3: the configuration in force did not move.
    expect((await securityService.getConfig(db)).configurationReleaseId).toBe(before.configurationReleaseId);
    expect(releasesOf(db).filter((release) => release.status === 'active')).toHaveLength(1);
  });

  it('a refused draft cannot be rolled back to', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await expect(securityService.updateConfig(db, { lgpd: { requireConsent: false } }, initial, req)).rejects.toMatchObject({ statusCode: 422 });
    const [draft] = releasesOf(db);
    await expect(securityService.rollbackConfig(db, draft.configurationReleaseId, req)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('a change failing another gate is refused without a violation (RF014 AC3/AC4)', () => {
  it('400, each gate reports its own result, and no violation_attempted event is written', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await expect(securityService.updateConfig(db, {
      passwordRules: { minLength: 4 },
      session: { timeoutMinutes: 1 },
    }, initial, req)).rejects.toMatchObject({ statusCode: 400 });

    const [run] = runsOf(db);
    expect(run).toMatchObject({ structuralResult: 'pass', semanticResult: 'fail', dependencyResult: 'pass', securityResult: 'fail', status: 'failed' });
    expect(run.findings.security).toContain('minLength deve estar entre 8 e 128');
    expect(run.findings.semantic).toContain('timeoutMinutes deve estar entre 5 e 480');
    expect(eventsOf(db).map((event) => event.changeType)).toEqual(['proposed']);
    expect(violationsOf(db)).toEqual([]);
  });

  it('a minLengthWithMFA above minLength fails the dependency gate', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    await expect(securityService.updateConfig(db, { passwordRules: { minLength: 10, minLengthWithMFA: 12 } }, initial, req))
      .rejects.toThrow('minLengthWithMFA não pode exceder minLength');
    expect(runsOf(db)[0]).toMatchObject({ dependencyResult: 'fail', securityResult: 'pass' });
  });

  it('still refuses the change when recording the refusal fails', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    vi.spyOn(configurationValidationService, 'recordRefusal').mockRejectedValue(new Error('runs write refused'));
    await expect(securityService.updateConfig(db, { session: { timeoutMinutes: 1 } }, initial, req)).rejects.toMatchObject({ statusCode: 400 });
    expect(releasesOf(db)).toEqual([]);
  });
});
