import { describe, it, expect } from 'vitest';

const {
  buildNeo4jSemanticPointer,
  mapSampleToNeo4jProps,
  buildUpsertSampleCypherParams
} = require('../../src/infrastructure/integration/semantic-pointer');

describe('buildNeo4jSemanticPointer', () => {
  it('builds the exact expected shape on the happy path', () => {
    const result = buildNeo4jSemanticPointer({ mongoId: 'abc123', collection: 'samples_fhir' });
    expect(result).toEqual({
      id: 'abc123',
      pointer: 'mongo://samples_fhir/abc123',
      collection: 'samples_fhir',
      sourceDb: 'mongodb',
      sourceCollection: 'samples_fhir'
    });
  });

  it('throws when mongoId is missing (undefined)', () => {
    expect(() => buildNeo4jSemanticPointer({ collection: 'samples_fhir' })).toThrow(
      /mongoId e collection são obrigatórios/
    );
  });

  it('throws when collection is missing', () => {
    expect(() => buildNeo4jSemanticPointer({ mongoId: 'abc123' })).toThrow(
      /mongoId e collection são obrigatórios/
    );
  });

  it('throws when mongoId is an empty string (falsy)', () => {
    expect(() => buildNeo4jSemanticPointer({ mongoId: '', collection: 'samples_fhir' })).toThrow();
  });

  it('BUG-CANDIDATE: throws when mongoId is the number 0, even though 0 could be a legitimate id', () => {
    // The guard `if (!mongoId || !collection)` treats numeric 0 as missing.
    // If a legitimate mongoId could ever be 0 (e.g. a numeric sequence id starting at 0),
    // this would incorrectly reject it. Documented here as a real behavior, not asserted as "correct".
    expect(() => buildNeo4jSemanticPointer({ mongoId: 0, collection: 'samples_fhir' })).toThrow();
  });

  it('does NOT throw when mongoId is the string "0" since it is truthy', () => {
    const result = buildNeo4jSemanticPointer({ mongoId: '0', collection: 'samples_fhir' });
    expect(result.id).toBe('0');
    expect(result.pointer).toBe('mongo://samples_fhir/0');
  });

  it('stringifies a non-string mongoId via String() coercion (ObjectId-like object)', () => {
    const fakeObjectId = {
      toString() {
        return '507f1f77bcf86cd799439011';
      }
    };
    const result = buildNeo4jSemanticPointer({ mongoId: fakeObjectId, collection: 'patients_fhir' });
    expect(result.id).toBe('507f1f77bcf86cd799439011');
    expect(result.pointer).toBe('mongo://patients_fhir/507f1f77bcf86cd799439011');
  });
});

describe('mapSampleToNeo4jProps', () => {
  it('builds the full expected shape on the happy path', () => {
    const sampleDoc = {
      _id: 'sample-1',
      semanticPointers: { mongoPatientId: 'patient-1' },
      identifier: [{ value: 'BARCODE-001' }],
      sampleID: 'ignored-sample-id',
      patientID: 'ignored-patient-id'
    };

    const result = mapSampleToNeo4jProps(sampleDoc);

    expect(result).toEqual({
      mongoSampleId: 'sample-1',
      sampleSemanticPointer: 'mongo://samples_fhir/sample-1',
      mongoPatientId: 'patient-1',
      patientSemanticPointer: 'mongo://patients_fhir/patient-1',
      barcode: 'BARCODE-001'
    });
  });

  it('throws when sampleDoc._id is missing', () => {
    expect(() => mapSampleToNeo4jProps({ patientID: 'patient-1' })).toThrow(
      /sampleDoc\._id é obrigatório/
    );
  });

  it('throws when sampleDoc is null', () => {
    expect(() => mapSampleToNeo4jProps(null)).toThrow(/sampleDoc\._id é obrigatório/);
  });

  it('falls back to patientID when semanticPointers.mongoPatientId is absent', () => {
    const sampleDoc = {
      _id: 'sample-2',
      patientID: 'patient-fallback'
    };

    const result = mapSampleToNeo4jProps(sampleDoc);

    expect(result.mongoPatientId).toBe('patient-fallback');
    expect(result.patientSemanticPointer).toBe('mongo://patients_fhir/patient-fallback');
  });

  it('barcode falls back to sampleID when identifier is absent', () => {
    const sampleDoc = {
      _id: 'sample-3',
      patientID: 'patient-3',
      sampleID: 'SAMPLE-CODE-3'
    };

    const result = mapSampleToNeo4jProps(sampleDoc);

    expect(result.barcode).toBe('SAMPLE-CODE-3');
  });

  it('barcode falls back to sampleID when identifier is an empty array', () => {
    const sampleDoc = {
      _id: 'sample-4',
      patientID: 'patient-4',
      identifier: [],
      sampleID: 'SAMPLE-CODE-4'
    };

    const result = mapSampleToNeo4jProps(sampleDoc);

    expect(result.barcode).toBe('SAMPLE-CODE-4');
  });

  it('barcode is null when neither identifier nor sampleID is present', () => {
    const sampleDoc = {
      _id: 'sample-5',
      patientID: 'patient-5'
    };

    const result = mapSampleToNeo4jProps(sampleDoc);

    expect(result.barcode).toBeNull();
  });

  it('propagates the inner throw when neither mongoPatientId nor patientID is present', () => {
    const sampleDoc = {
      _id: 'sample-6'
    };

    expect(() => mapSampleToNeo4jProps(sampleDoc)).toThrow(
      /mongoId e collection são obrigatórios/
    );
  });
});

describe('buildUpsertSampleCypherParams', () => {
  it('returns cypher and params matching mapSampleToNeo4jProps on the happy path', () => {
    const sampleDoc = {
      _id: 'sample-1',
      semanticPointers: { mongoPatientId: 'patient-1' },
      identifier: [{ value: 'BARCODE-001' }]
    };

    const expectedProps = mapSampleToNeo4jProps(sampleDoc);
    const result = buildUpsertSampleCypherParams(sampleDoc);

    expect(result.params).toEqual(expectedProps);
    expect(typeof result.cypher).toBe('string');
    expect(result.cypher.length).toBeGreaterThan(0);
    expect(result.cypher).toContain('MERGE');
    expect(result.cypher).toContain('Sample');
    expect(result.cypher).toContain('Donor');
    expect(result.cypher).toContain('COLLECTED_FROM');
  });

  it('throws when the underlying mapSampleToNeo4jProps would throw (missing _id)', () => {
    expect(() => buildUpsertSampleCypherParams({ patientID: 'patient-1' })).toThrow(
      /sampleDoc\._id é obrigatório/
    );
  });
});
