import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createEncounter,
  getEncountersForParticipant,
  getEncounterById,
} = require('../../../src/services/encounter.service');

/**
 * Real query-matching fake (exact-match filter + sort), not a canned stub --
 * proves getEncountersForParticipant actually scopes by participantId and
 * orders by recency, per this repo's native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => {
    const value = key.split('.').reduce((acc, part) => acc?.[part], doc);
    return value === filter[key];
  });
  return {
    docs,
    async insertOne(doc) {
      doc._id = `fake-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      let current = docs.filter((doc) => matches(doc, filter));
      const cursor = {
        sort(criteria = {}) {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const get = (doc) => field.split('.').reduce((acc, part) => acc?.[part], doc);
            const left = get(a)?.getTime ? get(a).getTime() : get(a);
            const right = get(b)?.getTime ? get(b).getTime() : get(b);
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        },
        async toArray() {
          return current;
        },
      };
      return cursor;
    },
  };
}

function createFakeDb() {
  const collections = { encounters: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('encounter.service', () => {
  describe('createEncounter', () => {
    it('persists an encounter document', async () => {
      const db = createFakeDb();

      const stored = await createEncounter(db, {
        participantId: 'PART-1',
        encounterType: 'outpatient',
        encounterPeriod: { start: '2026-01-01' },
      });

      expect(stored.participantId).toBe('PART-1');
      expect(db.collections.encounters.docs).toHaveLength(1);
      expect(db.collections.encounters.docs[0].participantId).toBe('PART-1');
    });

    it('propagates validation failures from the model instead of persisting an invalid document', async () => {
      const db = createFakeDb();

      await expect(createEncounter(db, {})).rejects.toThrow('participantId é obrigatório para Encounter');
      expect(db.collections.encounters.docs).toHaveLength(0);
    });
  });

  describe('getEncountersForParticipant', () => {
    it('scopes results to the requested participantId only', async () => {
      const db = createFakeDb();
      await createEncounter(db, { participantId: 'PART-1', encounterType: 'outpatient', encounterPeriod: { start: '2026-01-01' } });
      await createEncounter(db, { participantId: 'PART-2', encounterType: 'outpatient', encounterPeriod: { start: '2026-01-01' } });

      const encounters = await getEncountersForParticipant(db, 'PART-1');

      expect(encounters).toHaveLength(1);
      expect(encounters[0].participantId).toBe('PART-1');
    });

    it('returns encounters most-recent-first by encounterPeriod.start', async () => {
      const db = createFakeDb();
      await createEncounter(db, { participantId: 'PART-1', encounterType: 'outpatient', encounterPeriod: { start: '2026-01-01' } });
      await createEncounter(db, { participantId: 'PART-1', encounterType: 'inpatient', encounterPeriod: { start: '2026-06-01' } });

      const encounters = await getEncountersForParticipant(db, 'PART-1');

      expect(encounters.map((e) => e.encounterType)).toEqual(['inpatient', 'outpatient']);
    });
  });

  describe('getEncounterById', () => {
    it('resolves by encounterId, not Mongo _id', async () => {
      const db = createFakeDb();
      const created = await createEncounter(db, {
        encounterId: 'enc-fixed',
        participantId: 'PART-1',
        encounterType: 'outpatient',
        encounterPeriod: { start: '2026-01-01' },
      });

      const resolved = await getEncounterById(db, created.encounterId);

      expect(resolved.encounterId).toBe('enc-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb();
      expect(await getEncounterById(db, null)).toBeNull();
    });
  });
});
