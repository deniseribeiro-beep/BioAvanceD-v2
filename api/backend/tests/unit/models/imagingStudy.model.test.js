import { describe, it, expect } from 'vitest';

const ImagingStudyModel = require('../../../src/models/ImagingStudy');

describe('ImagingStudyModel (dict ELM-0353/0354, #721)', () => {
  const validStudy = () => ({
    dicomStudyUid: '1.2.840.113619.2.55.3.604688119.969.1268071029.320',
    series: [
      {
        uid: '1.2.840.113619.2.55.3.604688119.969.1268071029.321',
        modality: 'CT',
        bodySite: 'chest',
        numberOfInstances: 2,
        instance: [{ uid: '1.2.840.113619.2.55.3.1' }, { uid: '1.2.840.113619.2.55.3.2' }],
        endpoint: ['Endpoint/pacs-1'],
      },
    ],
  });

  const errorsOf = (data) => ImagingStudyModel.validate(data).errors;

  describe('validate', () => {
    it('a valid study passes with no errors', () => {
      const result = ImagingStudyModel.validate(validStudy());
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('a series with only uid and modality passes (the rest is optional)', () => {
      const result = ImagingStudyModel.validate({ ...validStudy(), series: [{ uid: '1.2.3', modality: 'MR' }] });
      expect(result.isValid).toBe(true);
    });

    it('a missing dicomStudyUid fails (1..1)', () => {
      expect(errorsOf({ ...validStudy(), dicomStudyUid: undefined }))
        .toEqual(['dicomStudyUid é obrigatório para ImagingStudy (1..1)']);
    });

    it.each([
      ['a letter', '1.2.abc.4'],
      ['a leading-zero component', '1.02.3'],
      ['65 characters', `1.${'2'.repeat(63)}`],
    ])('a dicomStudyUid with %s fails as not a DICOM UID', (_label, uid) => {
      expect(errorsOf({ ...validStudy(), dicomStudyUid: uid }))
        .toEqual(['dicomStudyUid deve ser um UID DICOM válido (PS3.5 9.1)']);
    });

    it('a 64-character dicomStudyUid passes', () => {
      expect(errorsOf({ ...validStudy(), dicomStudyUid: `1.${'2'.repeat(62)}` })).toEqual([]);
    });

    it('a missing series fails (1..*)', () => {
      expect(errorsOf({ ...validStudy(), series: undefined }))
        .toEqual(['series é obrigatório para ImagingStudy (1..*)']);
    });

    it('an empty series fails (1..*)', () => {
      expect(errorsOf({ ...validStudy(), series: [] }))
        .toEqual(['series é obrigatório para ImagingStudy (1..*)']);
    });

    it('a series that is not a list fails as such', () => {
      expect(errorsOf({ ...validStudy(), series: { uid: '1.2.3', modality: 'CT' } }))
        .toEqual(['series deve ser uma lista']);
    });

    it('a series entry that is not an object fails', () => {
      expect(errorsOf({ ...validStudy(), series: ['1.2.3'] })).toEqual(['series[0] deve ser um objeto']);
    });

    it('a series entry without uid fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ modality: 'CT' }] })).toEqual(['series[0].uid é obrigatório']);
    });

    it('a series entry with a uid that is not a DICOM UID fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.x', modality: 'CT' }] }))
        .toEqual(['series[0].uid deve ser um UID DICOM válido']);
    });

    it('a series entry without modality fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.3' }] })).toEqual(['series[0].modality é obrigatório']);
    });

    it('two series with one uid fail', () => {
      expect(errorsOf({
        ...validStudy(),
        series: [{ uid: '1.2.3', modality: 'CT' }, { uid: '1.2.3', modality: 'MR' }],
      })).toEqual(['series contém uid repetido: 1.2.3']);
    });

    it.each([-1, 1.5])('numberOfInstances of %s fails', (n) => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.3', modality: 'CT', numberOfInstances: n }] }))
        .toEqual(['series[0].numberOfInstances deve ser um inteiro não negativo']);
    });

    it('a bodySite that is empty fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.3', modality: 'CT', bodySite: ' ' }] }))
        .toEqual(['series[0].bodySite deve ser um código não vazio']);
    });

    it('an instance with a bad uid fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.3', modality: 'CT', instance: [{ uid: '1..2' }] }] }))
        .toEqual(['series[0].instance deve conter apenas objetos com uid DICOM válido']);
    });

    it('an endpoint entry that is empty fails', () => {
      expect(errorsOf({ ...validStudy(), series: [{ uid: '1.2.3', modality: 'CT', endpoint: [''] }] }))
        .toEqual(['series[0].endpoint deve conter apenas referências não vazias']);
    });

    it('returns every error found, not the first', () => {
      const errors = errorsOf({ dicomStudyUid: 'x', series: [{ uid: '1.2.3' }, { modality: 'CT' }] });
      expect(errors).toEqual([
        'dicomStudyUid deve ser um UID DICOM válido (PS3.5 9.1)',
        'series[0].modality é obrigatório',
        'series[1].uid é obrigatório',
      ]);
    });
  });

  describe('create', () => {
    it('create({}) does not throw and emits exactly the stored keys', () => {
      const doc = ImagingStudyModel.create({});
      expect(Object.keys(doc)).toEqual(['imagingStudyId', 'dicomStudyUid', 'series', 'createdAt', 'updatedAt']);
      expect(doc.imagingStudyId).toBeTruthy();
      expect(doc.dicomStudyUid).toBeNull();
      expect(doc.series).toEqual([]);
    });

    it('create copies each series entry rather than sharing it', () => {
      const input = validStudy();
      const doc = ImagingStudyModel.create(input);
      expect(doc.series).toEqual(input.series);
      expect(doc.series[0]).not.toBe(input.series[0]);
    });
  });
});
