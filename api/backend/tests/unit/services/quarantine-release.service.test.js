import { describe, it, expect, vi, afterEach } from 'vitest';

const quarantineReleaseService = require('../../../src/services/quarantine-release.service');
const quarantineActionService = require('../../../src/services/quarantine-action.service');
const consentService = require('../../../src/services/consent.service');

// RF019 AC5/AC6 (#1315): release needs evidence, a quarantined specimen and
// every open quarantine's rule satisfied; it closes each open action, audits
// it with the evidence, and records the specimen's state decision.
function buildDb(actions = []) {
  const collections = {
    samples: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }), createIndex: vi.fn().mockResolvedValue('ok') },
    quarantineActions: {
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(actions) }) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    },
    operationalStateDecisions: { insertOne: vi.fn().mockResolvedValue({ insertedId: 'osd-1' }) },
    graph_projection_outbox: { createIndex: vi.fn().mockResolvedValue('ok'), updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) },
    graph_projection_outbox_aggregate_versions: { findOneAndUpdate: vi.fn().mockResolvedValue({ version: 1 }) },
  };
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    }),
    ...collections,
  };
}

const sample = { _id: 'mongo-1', specimenId: 'SPC-1', participantId: '12345678', specimenStatus: 'quarantined' };
const release = (db, overrides = {}) => quarantineReleaseService.releaseQuarantine(db, overrides.sample || sample, {
  actorId: 'coord-1', evidenceIds: ['file-1'], reason: 'revisado', ...overrides,
});

describe('quarantine-release.service releaseQuarantine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('releases every open action with the actor, audits each with the evidence, and records the decision', async () => {
    const audit = vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const db = buildDb([
      { quarantineActionId: 'qa-nc', specimenIds: ['SPC-1'], reasonCodes: ['nonconformance'], actionStatus: 'active' },
      { quarantineActionId: 'qa-cold', specimenIds: ['SPC-1'], reasonCodes: ['COLD_CHAIN_INCIDENT'], actionStatus: 'pending_review' },
      { quarantineActionId: 'qa-old', specimenIds: ['SPC-1'], reasonCodes: ['manual'], actionStatus: 'released' },
    ]);

    const result = await release(db);

    expect(result.releasedActions.map((action) => action.quarantineActionId)).toEqual(['qa-nc', 'qa-cold']);
    expect(db.quarantineActions.updateOne).toHaveBeenCalledTimes(2);
    expect(db.quarantineActions.updateOne.mock.calls[0][1].$set).toMatchObject({ actionStatus: 'released', authorizedBy: 'coord-1' });
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[0][1]).toMatchObject({ decision: 'released', details: { evidenceIds: ['file-1'], reason: 'revisado' } });
    expect(db.samples.updateOne).toHaveBeenCalledWith({ _id: 'mongo-1' }, { $set: expect.objectContaining({ specimenStatus: 'available' }) });
    expect(db.operationalStateDecisions.insertOne.mock.calls[0][0]).toMatchObject({
      specimenId: 'SPC-1', previousStatus: 'quarantined', newStatus: 'available',
      triggerEventId: 'qa-cold', rulesApplied: ['quarantine_release'],
    });
  });

  it('refuses a release with no evidence (422)', async () => {
    const db = buildDb([]);
    await expect(release(db, { evidenceIds: [' '] })).rejects.toMatchObject({ statusCode: 422, code: 'EVIDENCE_REQUIRED' });
    expect(db.samples.updateOne).not.toHaveBeenCalled();
    expect(db.graph_projection_outbox.updateOne).not.toHaveBeenCalled();
  });

  it('appends one QUARANTINE_RELEASED outbox event per released action, carrying its specimens, rule, actor and evidence (RF019 AC6)', async () => {
    vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const db = buildDb([
      { quarantineActionId: 'qa-nc', specimenIds: ['SPC-1'], reasonCodes: ['nonconformance'], actionStatus: 'active' },
      { quarantineActionId: 'qa-old', specimenIds: ['SPC-1'], reasonCodes: ['manual'], actionStatus: 'released' },
    ]);

    await release(db);

    const events = db.graph_projection_outbox.updateOne.mock.calls.map((call) => call[1].$setOnInsert);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'QUARANTINE_RELEASED',
      aggregateType: 'QuarantineAction',
      aggregateId: 'qa-nc',
      sourceService: 'quarantine-release',
      payload: {
        quarantineActionId: 'qa-nc', specimenIds: ['SPC-1'], reasonCodes: ['nonconformance'],
        actionStatus: 'released', authorizedBy: 'coord-1', evidenceIds: ['file-1'],
      },
    });
    expect(events[0].payload.releasedAt).toBeInstanceOf(Date);
  });

  it('refuses a specimen that is not quarantined (409)', async () => {
    const db = buildDb([]);
    await expect(release(db, { sample: { ...sample, specimenStatus: 'available' } }))
      .rejects.toMatchObject({ statusCode: 409, code: 'NOT_QUARANTINED' });
  });

  it('refuses while a cold-chain incident is still open (409), releasing nothing', async () => {
    const db = buildDb([{ quarantineActionId: 'qa-cold', specimenIds: ['SPC-1'], reasonCodes: ['COLD_CHAIN_INCIDENT'], actionStatus: 'active' }]);
    await expect(release(db)).rejects.toMatchObject({
      statusCode: 409, code: 'QUARANTINE_RULE_UNSATISFIED',
      unsatisfied: [{ quarantineActionId: 'qa-cold', rule: 'cold_chain_incident_open' }],
    });
    expect(db.quarantineActions.updateOne).not.toHaveBeenCalled();
    expect(db.samples.updateOne).not.toHaveBeenCalled();
    expect(db.graph_projection_outbox.updateOne).not.toHaveBeenCalled();
  });

  it('refuses a consent quarantine while the participant\'s consent is not active, and releases it once it is', async () => {
    vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const consent = vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ status: 'REVOKED' });
    const actions = [{ quarantineActionId: 'qa-c', specimenIds: ['SPC-1'], reasonCodes: ['CONSENT_REVOKED'], actionStatus: 'active' }];

    await expect(release(buildDb(actions))).rejects.toMatchObject({
      statusCode: 409, unsatisfied: [{ quarantineActionId: 'qa-c', rule: 'consent_not_active' }],
    });
    expect(consent).toHaveBeenCalledWith(expect.anything(), '12345678');

    consent.mockResolvedValue({ status: 'ACTIVE' });
    const db = buildDb(actions);
    await expect(release(db)).resolves.toMatchObject({ specimenStatus: 'available' });
  });

  it('accepts an external consent document attached to the specimen for a consent quarantine', async () => {
    vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const consent = vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ status: 'REVOKED' });
    const actions = [{ quarantineActionId: 'qa-c', specimenIds: ['SPC-1'], reasonCodes: ['CONSENT_PENDING'], actionStatus: 'active' }];

    await expect(release(buildDb(actions), { sample: { ...sample, consentStatus: 'EXTERNAL_ATTACHED' } }))
      .resolves.toMatchObject({ specimenStatus: 'available' });
    expect(consent).not.toHaveBeenCalled();
  });
});
