import { describe, it, expect } from 'vitest';

const quarantineActionService = require('../../../src/services/quarantine-action.service');
const encounterService = require('../../../src/services/encounter.service');
const biomarkerObservationService = require('../../../src/services/biomarker-observation.service');
const sessionService = require('../../../src/services/session.service');
const userSecurityService = require('../../../src/services/user-security.service');
const { checkStaleTemperatureReadings } = require('../../../src/services/scheduler.service');
const { CANONICAL_COLLECTIONS } = require('../../../src/config/collections');
const { createFakeDb } = require('../foundation/helpers/fake-db');

/**
 * #1332: reads that pick the newest quarantine action, encounter,
 * observation, session or temperature reading. Each test stores its
 * documents out of the order it expects back, in a store that really
 * sorts, so a wrong key or direction in the read fails it.
 */

const day = (d) => new Date(`2026-02-${String(d).padStart(2, '0')}T00:00:00Z`);

describe('quarantine-action.service ordering', () => {
  async function storeActions(db) {
    const actions = db.collection(CANONICAL_COLLECTIONS.quarantineActions);
    await actions.insertOne({ quarantineActionId: 'mid', specimenIds: ['S1'], actionStatus: 'active', startedAt: day(2) });
    await actions.insertOne({ quarantineActionId: 'newest', specimenIds: ['S1', 'S2'], actionStatus: 'active', startedAt: day(3) });
    await actions.insertOne({ quarantineActionId: 'oldest', specimenIds: ['S1'], actionStatus: 'active', startedAt: day(1) });
    return actions;
  }

  it('getActionsForSpecimen lists the actions covering the specimen newest first', async () => {
    const db = createFakeDb();
    await storeActions(db);

    const listed = await quarantineActionService.getActionsForSpecimen(db, 'S1');

    expect(listed.map((action) => action.quarantineActionId)).toEqual(['newest', 'mid', 'oldest']);
  });

  it('releaseActiveAction releases the newest active action', async () => {
    const db = createFakeDb();
    const actions = await storeActions(db);

    const released = await quarantineActionService.releaseActiveAction(db, 'S1', 'qa-1', day(4));

    expect(released.quarantineActionId).toBe('newest');
    expect(actions.docs.filter((a) => a.actionStatus === 'released').map((a) => a.quarantineActionId)).toEqual(['newest']);
  });

  it('markPendingReview moves the newest active action', async () => {
    const db = createFakeDb();
    const actions = await storeActions(db);

    const updated = await quarantineActionService.markPendingReview(db, 'S1');

    expect(updated.quarantineActionId).toBe('newest');
    expect(actions.docs.filter((a) => a.actionStatus === 'pending_review').map((a) => a.quarantineActionId)).toEqual(['newest']);
  });
});

describe('encounter.service ordering', () => {
  it('getEncountersForParticipant lists the most recent encounter first', async () => {
    const db = createFakeDb();
    const encounters = db.collection(CANONICAL_COLLECTIONS.encounters);
    await encounters.insertOne({ encounterId: 'mid', participantId: 'P1', encounterPeriod: { start: day(2) } });
    await encounters.insertOne({ encounterId: 'newest', participantId: 'P1', encounterPeriod: { start: day(3) } });
    await encounters.insertOne({ encounterId: 'oldest', participantId: 'P1', encounterPeriod: { start: day(1) } });

    const listed = await encounterService.getEncountersForParticipant(db, 'P1');

    expect(listed.map((encounter) => encounter.encounterId)).toEqual(['newest', 'mid', 'oldest']);
  });
});

describe('biomarker-observation.service ordering', () => {
  it('listPatientObservations pages by collection date, newest first, then by creation', async () => {
    const db = createFakeDb();
    const observations = db.collection(CANONICAL_COLLECTIONS.biomarkerObservations);
    await observations.insertOne({ observationId: 'same-day-early', participantId: '12345678', value: 1, collectedAt: day(2), createdAt: day(2) });
    await observations.insertOne({ observationId: 'newest', participantId: '12345678', value: 2, collectedAt: day(3), createdAt: day(3) });
    await observations.insertOne({ observationId: 'oldest', participantId: '12345678', value: 3, collectedAt: day(1), createdAt: day(1) });
    await observations.insertOne({ observationId: 'same-day-late', participantId: '12345678', value: 4, collectedAt: day(2), createdAt: day(5) });

    const first = await biomarkerObservationService.listPatientObservations(db, '12345678', { limit: 2 });
    const second = await biomarkerObservationService.listPatientObservations(db, '12345678', { limit: 2, skip: 2 });

    expect(first.observations.map((o) => o.observationId)).toEqual(['newest', 'same-day-late']);
    expect(second.observations.map((o) => o.observationId)).toEqual(['same-day-early', 'oldest']);
  });
});

describe('active session lists', () => {
  async function storeSessions(db) {
    const sessions = db.collection('sessions');
    await sessions.insertOne({ sessionID: 'mid', userID: 'u1', isActive: true, lastActivity: day(2) });
    await sessions.insertOne({ sessionID: 'newest', userID: 'u1', isActive: true, lastActivity: day(3) });
    await sessions.insertOne({ sessionID: 'oldest', userID: 'u1', isActive: true, lastActivity: day(1) });
  }

  it('session.service.listUserSessions lists the most recently active session first', async () => {
    const db = createFakeDb();
    await storeSessions(db);

    const listed = await sessionService.listUserSessions(db, 'u1', null);

    expect(listed.map((session) => session.id)).toEqual(['newest', 'mid', 'oldest']);
  });

  it('user-security.service.getSessions lists the most recently active session first', async () => {
    const db = createFakeDb();
    await storeSessions(db);

    const listed = await userSecurityService.getSessions(db, 'u1', null);

    expect(listed.map((session) => session.id)).toEqual(['newest', 'mid', 'oldest']);
  });
});

describe('scheduler.service.checkStaleTemperatureReadings', () => {
  it('judges staleness by the newest reading, so a fresh reading stored first keeps the sensor quiet', async () => {
    const db = createFakeDb();
    await db.collection('sensors').insertOne({ sensorId: 'T1' });
    const temperatures = db.collection('temperatures');
    await temperatures.insertOne({ _id: 'r-fresh', sensorId: 'T1', timestamp: new Date() });
    await temperatures.insertOne({ _id: 'r-stale', sensorId: 'T1', timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000) });

    const result = await checkStaleTemperatureReadings(db);

    expect(result).toEqual({ sensors: 1, alerts: 0 });
    expect(db.collection('alerts').docs).toEqual([]);
  });
});
