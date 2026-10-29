import { describe, it, expect } from 'vitest';

const ImagingDerivedDataModel = require('../../../src/models/ImagingDerivedData');

describe('ImagingDerivedDataModel (dict ELM-0355/0356, #721)', () => {
  const validFeatureSet = () => ([
    {
      software: 'pyradiomics',
      features: [{ name: 'firstorder_Mean', value: 41.2 }, { name: 'glcm_Contrast', value: 3.1 }],
      parameters: { binWidth: 25 },
      regionOfInterest: 'tumor',
    },
  ]);

  const errorsOf = (data) => ImagingDerivedDataModel.validate(data).errors;
  const AT_LEAST_ONE = 'ImagingDerivedData requer segmentationFile ou featureSet';

  describe('validate', () => {
    it('a row with only segmentationFile passes', () => {
      const result = ImagingDerivedDataModel.validate({ segmentationFile: 'file-1' });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('a row with only a featureSet passes', () => {
      const result = ImagingDerivedDataModel.validate({ featureSet: validFeatureSet() });
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('an empty row is refused: it must fill segmentationFile or featureSet', () => {
      expect(errorsOf({})).toEqual([AT_LEAST_ONE]);
    });

    it('a row with only featureSet: [] is refused as empty', () => {
      expect(errorsOf({ featureSet: [] })).toEqual([AT_LEAST_ONE]);
    });

    it.each([
      ['a number', 42],
      ['a blank string', '  '],
    ])('a segmentationFile that is %s fails', (_label, value) => {
      expect(errorsOf({ segmentationFile: value }))
        .toEqual(['segmentationFile deve ser uma referência não vazia']);
    });

    it('a featureSet that is not a list fails as such, with no record-level error', () => {
      expect(errorsOf({ featureSet: { software: 'pyradiomics' } })).toEqual(['featureSet deve ser uma lista']);
    });

    it('a featureSet entry that is not an object fails', () => {
      expect(errorsOf({ featureSet: ['pyradiomics'] })).toEqual(['featureSet[0] deve ser um objeto']);
    });

    it('a featureSet entry without software fails', () => {
      expect(errorsOf({ featureSet: [{ features: [{ name: 'f' }] }] }))
        .toEqual(['featureSet[0].software é obrigatório']);
    });

    it.each([
      ['missing', undefined],
      ['empty', []],
      ['not a list', { name: 'f' }],
    ])('a featureSet entry with features %s fails', (_label, features) => {
      expect(errorsOf({ featureSet: [{ software: 'pyradiomics', features }] }))
        .toEqual(['featureSet[0].features é obrigatório']);
    });

    it('a feature without name fails', () => {
      expect(errorsOf({ featureSet: [{ software: 'pyradiomics', features: [{ value: 1 }] }] }))
        .toEqual(['featureSet[0].features deve conter apenas objetos com name']);
    });

    it('parameters that are not an object fail', () => {
      expect(errorsOf({ featureSet: [{ software: 's', features: [{ name: 'f' }], parameters: 'binWidth=25' }] }))
        .toEqual(['featureSet[0].parameters deve ser um objeto']);
    });

    it('a blank regionOfInterest fails', () => {
      expect(errorsOf({ featureSet: [{ software: 's', features: [{ name: 'f' }], regionOfInterest: '' }] }))
        .toEqual(['featureSet[0].regionOfInterest deve ser uma referência não vazia']);
    });

    it('returns every error found, not the first', () => {
      const errors = errorsOf({
        segmentationFile: '',
        featureSet: [{ features: [{ name: 'f' }] }, { software: 's' }],
      });
      expect(errors).toEqual([
        'segmentationFile deve ser uma referência não vazia',
        'featureSet[0].software é obrigatório',
        'featureSet[1].features é obrigatório',
      ]);
    });
  });

  describe('create', () => {
    it('create({}) does not throw and emits exactly the stored keys', () => {
      const doc = ImagingDerivedDataModel.create({});
      expect(Object.keys(doc)).toEqual(['imagingDerivedDataId', 'segmentationFile', 'featureSet', 'createdAt', 'updatedAt']);
      expect(doc.imagingDerivedDataId).toBeTruthy();
      expect(doc.segmentationFile).toBeNull();
      expect(doc.featureSet).toEqual([]);
    });

    it('create copies each featureSet entry rather than sharing it', () => {
      const input = { segmentationFile: 'file-1', featureSet: validFeatureSet() };
      const doc = ImagingDerivedDataModel.create(input);
      expect(doc.featureSet).toEqual(validFeatureSet());
      input.featureSet[0].software = 'changed';
      input.featureSet.push({ software: 'other', features: [{ name: 'g' }] });
      expect(doc.featureSet).toEqual(validFeatureSet());
    });
  });
});
