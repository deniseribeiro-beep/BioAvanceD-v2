import { describe, it, expect } from 'vitest';
const CollectionModel = require('../../src/models/Collection');

describe('CollectionModel.validate', () => {
  it('rejects missing collectionId', () => {
    const result = CollectionModel.validate({ collectionName: 'Coleção de doenças raras' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('collectionId é obrigatório e deve ser string');
  });

  it('rejects missing collectionName', () => {
    const result = CollectionModel.validate({ collectionId: 'col-1' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('collectionName é obrigatório e deve ser string');
  });

  it.each(CollectionModel.CODEABLE_CONCEPT_ARRAY_FIELDS)('rejects %s that is not a list', (field) => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção',
      [field]: 'not-a-list'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(`${field} deve ser uma lista`);
  });

  it('rejects relatedPublications that is not a list', () => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção',
      relatedPublications: 'doi:10.1000/xyz'
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('relatedPublications deve ser uma lista');
  });

  it('rejects exclusionCriteria that is not a string', () => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção',
      exclusionCriteria: 123
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('exclusionCriteria deve ser string');
  });

  it.each(['participantCount', 'sampleCount'])('rejects a negative %s', (field) => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção',
      [field]: -1
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(`${field} deve ser um inteiro não negativo`);
  });

  it.each(['participantCount', 'sampleCount'])('rejects a non-integer %s', (field) => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção',
      [field]: 1.5
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(`${field} deve ser um inteiro não negativo`);
  });

  it('accepts a fully valid MIABIS payload', () => {
    const result = CollectionModel.validate({
      collectionId: 'col-1',
      collectionName: 'Coleção de doenças raras',
      collectionStatus: 'active',
      sampleTypes: [{ code: 'plasma' }],
      datasetTypes: [{ code: 'genomic' }],
      diseaseScope: [{ code: 'ORPHA:558' }],
      inclusionCriteriaCategories: [{ code: 'rare-disease' }],
      exclusionCriteria: 'Pacientes menores de 18 anos',
      miabisUseAccessConditions: [{ code: 'DUO:0000042' }],
      storageTemperatureCategories: [{ code: '-80C' }],
      participantCount: 250,
      sampleCount: 1200,
      relatedPublications: [{ doi: '10.1000/xyz' }],
      governanceRegime: 'biobank'
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a minimal payload (identity fields and the governance regime)', () => {
    const result = CollectionModel.validate({ collectionId: 'col-1', collectionName: 'Coleção mínima', governanceRegime: 'biorepository' });
    expect(result.isValid).toBe(true);
  });

  // RF004 AC2, V2E-0427: biobank or biorepository, nothing else, never absent.
  it.each([undefined, null, '', 'hospital'])('rejects a governanceRegime of %s', (governanceRegime) => {
    const result = CollectionModel.validate({ collectionId: 'col-1', collectionName: 'Coleção', governanceRegime });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('governanceRegime é obrigatório e deve ser um de: biobank, biorepository');
  });
});

describe('CollectionModel.create', () => {
  it('defaults collectionStatus and every MIABIS field when not provided', () => {
    const doc = CollectionModel.create({ collectionId: 'col-1', collectionName: 'Coleção mínima' });

    expect(doc.collectionId).toBe('col-1');
    expect(doc.collectionName).toBe('Coleção mínima');
    expect(doc.collectionStatus).toBe('active');
    expect(doc.governanceRegime).toBeNull();
    expect(doc.exclusionCriteria).toBeNull();
    expect(doc.participantCount).toBeNull();
    expect(doc.sampleCount).toBeNull();
    expect(doc.relatedPublications).toEqual([]);
    for (const field of CollectionModel.CODEABLE_CONCEPT_ARRAY_FIELDS) {
      expect(doc[field]).toEqual([]);
    }
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  it('preserves every MIABIS field when provided', () => {
    const doc = CollectionModel.create({
      collectionId: 'col-1',
      collectionName: 'Coleção de doenças raras',
      collectionStatus: 'closed',
      sampleTypes: [{ code: 'plasma' }],
      datasetTypes: [{ code: 'genomic' }],
      diseaseScope: [{ code: 'ORPHA:558' }],
      inclusionCriteriaCategories: [{ code: 'rare-disease' }],
      exclusionCriteria: 'Pacientes menores de 18 anos',
      miabisUseAccessConditions: [{ code: 'DUO:0000042' }],
      storageTemperatureCategories: [{ code: '-80C' }],
      participantCount: 250,
      sampleCount: 1200,
      relatedPublications: [{ doi: '10.1000/xyz' }]
    });

    expect(doc.collectionStatus).toBe('closed');
    expect(doc.exclusionCriteria).toBe('Pacientes menores de 18 anos');
    expect(doc.participantCount).toBe(250);
    expect(doc.sampleCount).toBe(1200);
    expect(doc.relatedPublications).toEqual([{ doi: '10.1000/xyz' }]);
    expect(doc.sampleTypes).toEqual([{ code: 'plasma' }]);
    expect(doc.datasetTypes).toEqual([{ code: 'genomic' }]);
    expect(doc.diseaseScope).toEqual([{ code: 'ORPHA:558' }]);
    expect(doc.inclusionCriteriaCategories).toEqual([{ code: 'rare-disease' }]);
    expect(doc.miabisUseAccessConditions).toEqual([{ code: 'DUO:0000042' }]);
    expect(doc.storageTemperatureCategories).toEqual([{ code: '-80C' }]);
  });
});
