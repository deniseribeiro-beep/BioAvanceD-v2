import { describe, it, expect } from 'vitest';

const ExtractionProtocolModel = require('../../../src/models/ExtractionProtocol');
const QualityDescriptionModel = require('../../../src/models/QualityDescription');
const SampleOriginModel = require('../../../src/models/SampleOrigin');
const SampleTypeModel = require('../../../src/models/SampleType');

// #881: these four models' numeric idField (protocolID/qualityID/originID/
// sampleTypeID) is retired. The canonical business identifier, settled by
// #902, is the string MIABIS code the seed writes on `id` -- there is no
// per-model numeric-type validation branch anymore, so these cases are keyed
// on `id` instead.
const models = [
  {
    name: 'ExtractionProtocolModel',
    Model: ExtractionProtocolModel,
    extraField: 'code',
  },
  {
    name: 'QualityDescriptionModel',
    Model: QualityDescriptionModel,
    extraField: 'qualityLevel',
  },
  {
    name: 'SampleOriginModel',
    Model: SampleOriginModel,
    extraField: 'code',
  },
  {
    name: 'SampleTypeModel',
    Model: SampleTypeModel,
    extraField: 'code',
  },
];

describe.each(models)('$name', ({ Model, extraField }) => {
  describe('validate', () => {
    it('happy path: description only, no id -> isValid true, no errors', () => {
      const result = Model.validate({ description: 'A valid description' });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('description missing -> isValid false, includes description error', () => {
      const result = Model.validate({});

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('description é obrigatório e deve ser string');
    });

    it('description wrong type (number) -> isValid false', () => {
      const result = Model.validate({ description: 123 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('description é obrigatório e deve ser string');
    });

    it('id provided as a string -> isValid true, no id-related error', () => {
      const result = Model.validate({ description: 'ok', id: 'PLASMA' });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('create', () => {
    it('full data including extra field -> echoes fields plus Date instances', () => {
      const input = {
        description: 'Full description',
        id: 'PLASMA',
        [extraField]: 'CODE-01',
      };

      const result = Model.create(input);

      expect(result.description).toBe('Full description');
      expect(result.id).toBe('PLASMA');
      expect(result[extraField]).toBe('CODE-01');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('data without extra field -> extra field defaults to null (not undefined)', () => {
      const result = Model.create({ description: 'No extra field', id: 'PLASMA' });

      expect(result[extraField]).toBeNull();
      expect(result[extraField]).not.toBeUndefined();
    });

    it('#881: a POST-supplied string id survives create() unchanged', () => {
      const result = Model.create({ description: 'ok', id: 'PLASMA' });

      expect(result.id).toBe('PLASMA');
    });
  });
});
