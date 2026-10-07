import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configurationReleaseService = require('../../../src/services/configurationRelease.service');
const securityService = require('../../../src/services/security.service');
const retentionPolicyService = require('../../../src/services/retentionPolicy.service');
const sessionService = require('../../../src/services/session.service');
const auditLogger = require('../../../src/utils/auditLogger');
const ConfigurationReleaseModel = require('../../../src/models/ConfigurationRelease');
const ConfigurationChangeEventModel = require('../../../src/models/ConfigurationChangeEvent');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * RF014 AC2/AC4/AC7: a configuration change is a new, immutable
 * ConfigurationRelease; a rollback is a new release restoring an older
 * one's settings; each step appends a ConfigurationChangeEvent.
 */
const releasesOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationReleases).docs;
const eventsOf = (db) => db.collection(CANONICAL_COLLECTIONS.configurationChangeEvents).docs;

describe('ConfigurationReleaseModel', () => {
  it('checksums the settings independently of key order', () => {
    const a = ConfigurationReleaseModel.settingsChecksum({ session: { timeoutMinutes: 30, autoRenewal: true }, lgpd: { allowDataExport: true } });
    const b = ConfigurationReleaseModel.settingsChecksum({ lgpd: { allowDataExport: true }, session: { autoRenewal: true, timeoutMinutes: 30 } });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ConfigurationReleaseModel.settingsChecksum({ session: { timeoutMinutes: 31, autoRenewal: true }, lgpd: { allowDataExport: true } })).not.toBe(a);
  });

  it('refuses an active release without an approver, and settings that do not match the checksum', () => {
    const release = ConfigurationReleaseModel.createActive({ profileId: 'p', settings: { a: { b: 1 } }, version: 1, approvedBy: 'admin' });
    expect(ConfigurationReleaseModel.validate(release).isValid).toBe(true);
    expect(ConfigurationReleaseModel.validate({ ...release, approvedBy: null }).errors).toContain('approvedBy e approvedAt são obrigatórios para ativação');
    expect(ConfigurationReleaseModel.validate({ ...release, settings: { a: { b: 2 } } }).errors).toContain('checksum não corresponde a settings');
  });

  it('a rolled_back event must name the activation it undoes', () => {
    expect(() => ConfigurationChangeEventModel.create({ releaseId: 'r', changeType: 'rolled_back', actorId: 'a', impactSummary: 's' }))
      .toThrow('rollbackOf');
  });
});

describe('configurationRelease.service.activate', () => {
  const baseline = { settings: { session: { timeoutMinutes: 30 } }, approvedBy: 'admin-0' };

  it('records the configuration in force as the baseline, then supersedes it with the change', async () => {
    const db = createFakeDb();
    const release = await configurationReleaseService.activate(db, {
      profileId: 'prof-1', settings: { session: { timeoutMinutes: 15 } }, actorId: 'admin-1', impactSummary: 'Alterado: session.timeoutMinutes.', baseline,
    });

    const [first, second] = releasesOf(db);
    expect(first).toEqual(expect.objectContaining({ semanticVersion: '1.0.0', status: 'superseded', approvedBy: 'admin-0', settings: baseline.settings }));
    expect(first.effectivePeriod.end).toBeInstanceOf(Date);
    expect(second).toBe(release);
    expect(release).toEqual(expect.objectContaining({
      semanticVersion: '2.0.0', status: 'active', approvedBy: 'admin-1', supersedesId: first.configurationReleaseId, rollbackTargetId: null,
    }));
    expect(release.effectivePeriod.end).toBeNull();
    expect(eventsOf(db).map((event) => [event.releaseId, event.changeType])).toEqual([
      [first.configurationReleaseId, 'activated'],
      [release.configurationReleaseId, 'activated'],
    ]);
  });

  it('never rewrites an earlier release: its settings and checksum survive every later change', async () => {
    const db = createFakeDb();
    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { session: { timeoutMinutes: 15 } }, actorId: 'a', impactSummary: 's', baseline });
    const [first] = releasesOf(db);
    const snapshot = JSON.stringify({ settings: first.settings, checksum: first.checksum });

    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { session: { timeoutMinutes: 10 } }, actorId: 'a', impactSummary: 's', baseline });
    expect(JSON.stringify({ settings: first.settings, checksum: first.checksum })).toBe(snapshot);
    expect(releasesOf(db).filter((row) => row.status === 'active')).toHaveLength(1);
    expect(releasesOf(db).map((row) => row.semanticVersion)).toEqual(['1.0.0', '2.0.0', '3.0.0']);
  });

  it('refuses with 409 when another activation superseded the release first', async () => {
    const db = createFakeDb();
    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 1 } }, actorId: 'a', impactSummary: 's', baseline });
    const releases = db.collection(CANONICAL_COLLECTIONS.configurationReleases);
    vi.spyOn(releases, 'updateOne').mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });

    await expect(configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 2 } }, actorId: 'a', impactSummary: 's' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(releasesOf(db)).toHaveLength(2);
  });

  it('restores the previous active release when the unique index refuses the insert', async () => {
    const db = createFakeDb();
    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 1 } }, actorId: 'a', impactSummary: 's', baseline });
    const active = releasesOf(db).find((row) => row.status === 'active');
    const releases = db.collection(CANONICAL_COLLECTIONS.configurationReleases);
    vi.spyOn(releases, 'insertOne').mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    await expect(configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 2 } }, actorId: 'a', impactSummary: 's' }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(active.status).toBe('active');
    expect(active.effectivePeriod.end).toBeNull();
  });

  it('builds the one-active-release constraint before writing', async () => {
    const createIndex = vi.fn().mockResolvedValue('ok');
    const db = createFakeDb({ [CANONICAL_COLLECTIONS.configurationReleases]: () => ({ createIndex }) });
    require('../../../src/utils/configurationReleaseIndexes').resetConfigurationReleaseIndexLatch();
    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 1 } }, actorId: 'a', impactSummary: 's' });
    expect(createIndex).toHaveBeenCalledWith(
      { profileId: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { status: 'active' } })
    );
  });
});

describe('configurationRelease.service.rollbackTarget', () => {
  it('accepts only an inactive release of the same profile', async () => {
    const db = createFakeDb();
    await configurationReleaseService.activate(db, { profileId: 'prof-1', settings: { s: { a: 2 } }, actorId: 'a', impactSummary: 's', baseline: { settings: { s: { a: 1 } }, approvedBy: 'a' } });
    const [old, current] = releasesOf(db);

    await expect(configurationReleaseService.rollbackTarget(db, 'prof-1', old.configurationReleaseId)).resolves.toBe(old);
    await expect(configurationReleaseService.rollbackTarget(db, 'prof-1', 'nope')).rejects.toMatchObject({ statusCode: 404 });
    await expect(configurationReleaseService.rollbackTarget(db, 'prof-2', old.configurationReleaseId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(configurationReleaseService.rollbackTarget(db, 'prof-1', current.configurationReleaseId)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('securityService: saving and rolling back the security configuration (RF014 AC2/AC4)', () => {
  const req = { user: { userID: 'admin-1' }, headers: { authorization: 'Bearer t' } };

  beforeEach(() => {
    vi.spyOn(retentionPolicyService, 'getActivePolicy').mockResolvedValue(null);
    vi.spyOn(sessionService, 'revokeAllSessionsForPolicyChange').mockResolvedValue(0);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue({});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a save activates a release the document then names; a rollback restores the old value as a new release', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    // #966: the stored document carries its own id and environment.
    const stored = db.collection('security_config').docs[0];
    expect(stored.securityConfigId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.environment).toBe(require('../../../src/config/env').NODE_ENV);
    const originalTimeout = initial.session.timeoutMinutes;

    const saved = await securityService.updateConfig(db, { session: { timeoutMinutes: originalTimeout - 5 } }, initial, req);
    const [baseline, change] = releasesOf(db);
    expect(baseline.settings.session.timeoutMinutes).toBe(originalTimeout);
    expect(change.settings.session.timeoutMinutes).toBe(originalTimeout - 5);
    expect(saved.configurationReleaseId).toBe(change.configurationReleaseId);
    expect(saved.effectivePeriod).toEqual(change.effectivePeriod);
    expect(saved.securityConfigId).toBe(stored.securityConfigId);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ path: 'session.timeoutMinutes', configurationReleaseId: change.configurationReleaseId }),
    }));

    const current = await securityService.getConfig(db);
    const rolledBack = await securityService.rollbackConfig(db, baseline.configurationReleaseId, req);
    expect(rolledBack.session.timeoutMinutes).toBe(originalTimeout);

    const releases = releasesOf(db);
    expect(releases).toHaveLength(3);
    const restoring = releases[2];
    expect(restoring).toEqual(expect.objectContaining({
      status: 'active', rollbackTargetId: baseline.configurationReleaseId, supersedesId: change.configurationReleaseId,
    }));
    expect(restoring.checksum).toBe(ConfigurationReleaseModel.settingsChecksum(restoring.settings));
    expect(baseline.status).toBe('superseded');
    expect(change.status).toBe('superseded');
    expect(current.configurationReleaseId).toBe(change.configurationReleaseId);

    const events = eventsOf(db);
    const rollbackEvent = events[events.length - 1];
    const undone = events.find((event) => event.releaseId === change.configurationReleaseId);
    expect(rollbackEvent).toEqual(expect.objectContaining({ changeType: 'rolled_back', releaseId: restoring.configurationReleaseId, rollbackOf: undone.configurationChangeEventId, actorId: 'admin-1' }));

    const listed = await securityService.listReleases(db);
    expect(listed.map((row) => row.configurationReleaseId)).toEqual([restoring, change, baseline].map((row) => row.configurationReleaseId));
  });

  it('refuses a rollback to the release already in force', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    const saved = await securityService.updateConfig(db, { session: { timeoutMinutes: 20 } }, initial, req);
    await expect(securityService.rollbackConfig(db, saved.configurationReleaseId, req)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a page echoing the server-owned fields back records no change for them', async () => {
    const db = createFakeDb();
    const initial = await securityService.getConfig(db);
    const saved = await securityService.updateConfig(db, { session: { timeoutMinutes: 20 } }, initial, req);
    const echoed = JSON.parse(JSON.stringify(saved));
    expect(securityService.detectChanges(saved, echoed)).toEqual([]);
  });
});
