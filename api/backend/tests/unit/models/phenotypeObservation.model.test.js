import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PhenotypeObservationModel = require('../../../src/models/PhenotypeObservation');

const HPO_CODING = { systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001', version: '2026-01-01' };

describe('PhenotypeObservationModel', () => {
  describe('create', () => {
    it('requires participantId, hpoCoding, presenceStatus, and effectiveDateTime', () => {
      expect(() => PhenotypeObservationModel.create({})).toThrow(
        'participantId é obrigatório para PhenotypeObservation, hpoCoding é obrigatório para PhenotypeObservation (systemUri e code), presenceStatus é obrigatório para PhenotypeObservation e deve ser um de: present|absent|unknown|not_assessed, effectiveDateTime é obrigatório para PhenotypeObservation'
      );
    });

    it('rejects an invalid presenceStatus rather than silently accepting it', () => {
      expect(() =>
        PhenotypeObservationModel.create({
          participantId: 'PART-1',
          hpoCoding: HPO_CODING,
          presenceStatus: 'maybe',
          effectiveDateTime: '2026-01-01',
        })
      ).toThrow('presenceStatus é obrigatório para PhenotypeObservation e deve ser um de: present|absent|unknown|not_assessed');
    });

    it('treats an omitted presenceStatus as invalid, not as any particular default (dict-02: ausente != não preenchido)', () => {
      expect(() =>
        PhenotypeObservationModel.create({ participantId: 'PART-1', hpoCoding: HPO_CODING, effectiveDateTime: '2026-01-01' })
      ).toThrow(/presenceStatus é obrigatório/);
    });

    it('accepts an explicit "absent" presenceStatus as a genuine recorded observation', () => {
      const doc = PhenotypeObservationModel.create({
        participantId: 'PART-1',
        hpoCoding: HPO_CODING,
        presenceStatus: 'absent',
        effectiveDateTime: '2026-01-01',
      });

      expect(doc.presenceStatus).toBe('absent');
    });

    it('builds a full observation document with a generated phenotypeObservationId', () => {
      const doc = PhenotypeObservationModel.create({
        participantId: 'PART-1',
        hpoCoding: HPO_CODING,
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
      });

      expect(doc.phenotypeObservationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.hpoCoding).toEqual(HPO_CODING);
      expect(doc.encounterId).toBeNull();
      expect(doc.phenotypeEvidence).toEqual([]);
      expect(doc.effectiveDateTime).toBeInstanceOf(Date);
    });

    it('rejects hpoCoding missing systemUri or code', () => {
      expect(() =>
        PhenotypeObservationModel.create({
          participantId: 'PART-1',
          hpoCoding: { code: 'HP:0000001' },
          presenceStatus: 'present',
          effectiveDateTime: '2026-01-01',
        })
      ).toThrow('hpoCoding é obrigatório');
    });

    it('carries an optional encounterId joining back to #689 (0..1, unenforced)', () => {
      const doc = PhenotypeObservationModel.create({
        participantId: 'PART-1',
        hpoCoding: HPO_CODING,
        presenceStatus: 'present',
        effectiveDateTime: '2026-01-01',
        encounterId: 'enc-1',
      });

      expect(doc.encounterId).toBe('enc-1');
    });
  });
});
