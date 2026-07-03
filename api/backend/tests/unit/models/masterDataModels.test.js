import { describe, it, expect } from 'vitest';

const ExtractionProtocolModel = require('../../../src/models/ExtractionProtocol');
const QualityDescriptionModel = require('../../../src/models/QualityDescription');
const SampleOriginModel = require('../../../src/models/SampleOrigin');
const SampleTypeModel = require('../../../src/models/SampleType');

const models = [
  {
    name: 'ExtractionProtocolModel',
    Model: ExtractionProtocolModel,
    idField: 'protocolID',
    idErrorMsg: 'protocolID deve ser um número',
    extraField: 'code',
  },
  {
    name: 'QualityDescriptionModel',
    Model: QualityDescriptionModel,
    idField: 'qualityID',
    idErrorMsg: 'qualityID deve ser um número',
    extraField: 'qualityLevel',
  },
  {
    name: 'SampleOriginModel',
    Model: SampleOriginModel,
    idField: 'originID',
    idErrorMsg: 'originID deve ser um número',
    extraField: 'code',
  },
  {
    name: 'SampleTypeModel',
    Model: SampleTypeModel,
    idField: 'sampleTypeID',
    idErrorMsg: 'sampleTypeID deve ser um número',
    extraField: 'code',
  },
];

describe.each(models)('$name', ({ Model, idField, idErrorMsg, extraField }) => {
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

    it('id provided as a number -> isValid true, no id-related error', () => {
      const result = Model.validate({ description: 'ok', [idField]: 5 });

      expect(result.isValid).toBe(true);
      expect(result.errors).not.toContain(idErrorMsg);
    });

    it('id provided as a non-number (string) -> isValid false, includes id-type error', () => {
      const result = Model.validate({ description: 'ok', [idField]: 'not-a-number' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(idErrorMsg);
    });

    it('id explicitly null -> treated as not provided, no id-related error', () => {
      const result = Model.validate({ description: 'ok', [idField]: null });

      expect(result.isValid).toBe(true);
      expect(result.errors).not.toContain(idErrorMsg);
    });
  });

  describe('create', () => {
    it('full data including extra field -> echoes fields plus Date instances', () => {
      const input = {
        description: 'Full description',
        [idField]: 7,
        [extraField]: 'CODE-01',
      };

      const result = Model.create(input);

      expect(result.description).toBe('Full description');
      expect(result[idField]).toBe(7);
      expect(result[extraField]).toBe('CODE-01');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('data without extra field -> extra field defaults to null (not undefined)', () => {
      const result = Model.create({ description: 'No extra field', [idField]: 1 });

      expect(result[extraField]).toBeNull();
      expect(result[extraField]).not.toBeUndefined();
    });
  });
});
