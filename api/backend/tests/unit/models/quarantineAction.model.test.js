import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const QuarantineActionModel = require('../../../src/models/QuarantineAction');

describe('QuarantineActionModel', () => {
  describe('create', () => {
    it('requires specimenIds (1..*)', () => {
      expect(() => QuarantineActionModel.create({})).toThrow('specimenIds é obrigatório para QuarantineAction (1..*)');
      expect(() => QuarantineActionModel.create({ specimenIds: [] })).toThrow('specimenIds é obrigatório para QuarantineAction (1..*)');
    });

    it('builds a full action document with defaults for missing fields', () => {
      const doc = QuarantineActionModel.create({ specimenIds: ['SPEC-1'] });

      expect(doc.quarantineActionId).toBeTruthy();
      expect(doc.specimenIds).toEqual(['SPEC-1']);
      expect(doc.reasonCodes).toEqual([]);
      expect(doc.actionStatus).toBe('active');
      expect(doc.startedAt).toBeInstanceOf(Date);
      expect(doc.releasedAt).toBeNull();
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it('accepts a single specimenId (not just an array) — batch is the exception, not the rule', () => {
      const doc = QuarantineActionModel.create({ specimenIds: 'SPEC-1' });
      expect(doc.specimenIds).toEqual(['SPEC-1']);
    });

    it('accepts a batch of specimenIds — one action may cover every specimen tied to one incident', () => {
      const doc = QuarantineActionModel.create({ specimenIds: ['SPEC-1', 'SPEC-2', 'SPEC-3'] });
      expect(doc.specimenIds).toEqual(['SPEC-1', 'SPEC-2', 'SPEC-3']);
    });

    it('rejects an actionStatus outside the documented local extension', () => {
      expect(() => QuarantineActionModel.create({ specimenIds: ['SPEC-1'], actionStatus: 'bogus' }))
        .toThrow('actionStatus inválido: bogus');
    });

    it('accepts the local-extension statuses (dict-02 baseline is only `active`)', () => {
      expect(QuarantineActionModel.create({ specimenIds: ['SPEC-1'], actionStatus: 'RELEASED' }).actionStatus).toBe('released');
      expect(QuarantineActionModel.create({ specimenIds: ['SPEC-1'], actionStatus: 'pending_review' }).actionStatus).toBe('pending_review');
    });

    it('honors an explicit startedAt (for backfilled/historical actions)', () => {
      const doc = QuarantineActionModel.create({ specimenIds: ['SPEC-1'], startedAt: '2026-01-01T00:00:00.000Z' });
      expect(doc.startedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('release', () => {
    it('sets actionStatus to released and stamps releasedAt (0..1, present only once released)', () => {
      const action = QuarantineActionModel.create({ specimenIds: ['SPEC-1'] });
      expect(action.releasedAt).toBeNull();

      const released = QuarantineActionModel.release(action, '2026-02-01T00:00:00.000Z');

      expect(released.actionStatus).toBe('released');
      expect(released.releasedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(released.quarantineActionId).toBe(action.quarantineActionId);
    });
  });
});
