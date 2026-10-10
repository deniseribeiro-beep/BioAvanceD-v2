import { describe, it, expect } from 'vitest';

const OperationalStateDecisionModel = require('../../../src/models/OperationalStateDecision');
const service = require('../../../src/services/operationalStateDecision.service');

describe('OperationalStateDecisionModel (V2E-0159..0167, RF006 AC7)', () => {
  const ok = { specimenId: 'SPC-1', previousStatus: 'available', newStatus: 'Partial', triggerEventId: 'MOV-1', rulesApplied: ['quantity_derived_status'] };

  it('creates a permitted decision with an id and an instant, its codes lowercased', () => {
    const decision = OperationalStateDecisionModel.create(ok);
    expect(decision).toMatchObject({ specimenId: 'SPC-1', previousStatus: 'available', newStatus: 'partial', decisionResult: 'permit', reasonCodes: [] });
    expect(decision.operationalStateDecisionId).toEqual(expect.any(String));
    expect(decision.occurredAt).toBeInstanceOf(Date);
  });

  it('requires the specimen, the new status, the trigger and at least one rule', () => {
    for (const field of ['specimenId', 'newStatus', 'triggerEventId']) {
      expect(() => OperationalStateDecisionModel.create({ ...ok, [field]: undefined })).toThrow(field);
    }
    expect(() => OperationalStateDecisionModel.create({ ...ok, rulesApplied: [] })).toThrow('rulesApplied');
  });

  it('accepts only permit, and refuses a decision that changes nothing', () => {
    expect(() => OperationalStateDecisionModel.create({ ...ok, decisionResult: 'deny' })).toThrow('decisionResult');
    expect(() => OperationalStateDecisionModel.create({ ...ok, newStatus: 'available' })).toThrow('mudança');
  });
});

describe('operationalStateDecision.service (append-only)', () => {
  function fakeDb() {
    const docs = [];
    const collection = {
      docs,
      insertOne: async (doc, options) => { docs.push({ doc, options }); return { insertedId: docs.length }; },
      find: (filter) => ({ toArray: async () => docs.map((row) => row.doc).filter((doc) => doc.specimenId === filter.specimenId) }),
    };
    return { collection: () => collection, docs };
  }

  it('exports no way to update or delete a decision', () => {
    expect(Object.keys(service).sort()).toEqual(['historyOf', 'recordStatusChange']);
  });

  it('appends a change in the caller session, skips a status that stays, and reads the history oldest first', async () => {
    const db = fakeDb();
    const session = { id: 'sess' };
    await service.recordStatusChange(db, { specimenId: 'SPC-1', previousStatus: 'partial', newStatus: 'depleted', triggerEventId: 'MOV-2', rulesApplied: ['r'], occurredAt: '2026-02-01T00:00:00Z' }, { session });
    await service.recordStatusChange(db, { specimenId: 'SPC-1', previousStatus: 'available', newStatus: 'partial', triggerEventId: 'MOV-1', rulesApplied: ['r'], occurredAt: '2026-01-01T00:00:00Z' });
    expect(await service.recordStatusChange(db, { specimenId: 'SPC-1', previousStatus: 'Partial', newStatus: 'partial', triggerEventId: 'MOV-3', rulesApplied: ['r'] })).toBeNull();
    expect(db.docs).toHaveLength(2);
    expect(db.docs[0].options).toEqual({ session });
    expect((await service.historyOf(db, 'SPC-1')).map((d) => d.triggerEventId)).toEqual(['MOV-1', 'MOV-2']);
  });
});
