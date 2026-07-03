import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const express = require('express');
const request = require('supertest');

const modulePaths = {
  neo4j: require.resolve('../../src/database/neo4j'),
  patient: require.resolve('../../src/models/Patient'),
  sample: require.resolve('../../src/models/Sample'),
  observation: require.resolve('../../src/models/Observation'),
  audit: require.resolve('../../src/services/auditRoot.service'),
  logger: require.resolve('../../src/utils/logger'),
  router: require.resolve('../../src/routes/importFhirIntelligent'),
};

function setCachedModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

describe('POST /api/import/fhir-intelligent integration', () => {
  let app;
  let fakeSession;
  let fakeDriver;
  let PatientModel;
  let SampleModel;
  let ObservationModel;
  let auditService;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();

    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }

    fakeSession = {
      run: vi.fn().mockResolvedValue({ records: [] }),
      close: vi.fn().mockResolvedValue(),
    };
    fakeDriver = {
      session: vi.fn(() => fakeSession),
    };

    PatientModel = { findOneAndUpdate: vi.fn().mockResolvedValue({}) };
    SampleModel = { findOneAndUpdate: vi.fn().mockResolvedValue({}) };
    ObservationModel = { findOneAndUpdate: vi.fn().mockResolvedValue({}) };
    auditService = { log: vi.fn().mockResolvedValue() };
    logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };

    setCachedModule(modulePaths.neo4j, { getNeo4jDriver: () => fakeDriver });
    setCachedModule(modulePaths.patient, PatientModel);
    setCachedModule(modulePaths.sample, SampleModel);
    setCachedModule(modulePaths.observation, ObservationModel);
    setCachedModule(modulePaths.audit, auditService);
    setCachedModule(modulePaths.logger, logger);

    const router = require(modulePaths.router);

    app = express();
    app.use(express.json());
    app.use('/api/import', router);
  });

  afterEach(() => {
    delete process.env.FHIR_SEMANTIC_STRICT;
    for (const modulePath of Object.values(modulePaths)) {
      delete require.cache[modulePath];
    }
  });

  function validBundle() {
    return {
      resourceType: 'Bundle',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'pat-1',
            name: [{ text: 'Jane Doe' }],
          },
        },
        {
          resource: {
            resourceType: 'Specimen',
            id: 'spec-1',
            subject: { reference: 'Patient/pat-1' },
            type: {
              coding: [
                { system: 'http://www.orpha.net', code: 'ORPHA:558', display: 'Marfan syndrome' },
              ],
            },
          },
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs-1',
            subject: { reference: 'Specimen/spec-1' },
            code: {
              coding: [
                { system: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0001166', display: 'Arachnodactyly' },
              ],
            },
          },
        },
      ],
    };
  }

  it('returns 400 when body is missing resourceType Bundle', async () => {
    const response = await request(app).post('/api/import/fhir-intelligent').send({ entry: [] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Bundle FHIR inválido' });
    expect(PatientModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when entry is not an array', async () => {
    const response = await request(app)
      .post('/api/import/fhir-intelligent')
      .send({ resourceType: 'Bundle', entry: 'not-an-array' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Bundle FHIR inválido' });
  });

  it('imports Patient, Specimen (with valid ORPHA coding) and Observation (with valid HPO coding)', async () => {
    fakeSession.run.mockResolvedValue({
      records: [{ get: () => ({ properties: { code: 'ORPHA:558', name: 'Marfan syndrome' } }) }],
    });

    const response = await request(app).post('/api/import/fhir-intelligent').send(validBundle());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      imported: 3,
      semanticContract: { strictMode: false, warnings: [] },
    });

    expect(PatientModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(PatientModel.findOneAndUpdate).toHaveBeenCalledWith(
      { patientID: 'pat-1' },
      { $set: { patientName: 'Jane Doe', fhir: expect.objectContaining({ id: 'pat-1' }) } },
      { upsert: true }
    );

    expect(SampleModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(SampleModel.findOneAndUpdate).toHaveBeenCalledWith(
      { sampleID: 'spec-1' },
      {
        $set: {
          patientID: 'pat-1',
          fhir: expect.objectContaining({ id: 'spec-1' }),
          orpha: { code: 'ORPHA:558', name: 'Marfan syndrome' },
        },
      },
      { upsert: true }
    );

    expect(ObservationModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(ObservationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { observationID: 'obs-1' },
      { $set: { sampleID: 'spec-1', fhir: expect.objectContaining({ id: 'obs-1' }) } },
      { upsert: true }
    );

    expect(auditService.log).toHaveBeenCalledTimes(3);
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });

  it('non-strict mode: proceeds with import when Specimen is missing ORPHA coding, reporting warning', async () => {
    const bundle = validBundle();
    bundle.entry[1].resource.type.coding = [];

    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.imported).toBe(3);
    expect(response.body.semanticContract.strictMode).toBe(false);
    expect(response.body.semanticContract.warnings).toEqual([
      expect.objectContaining({ type: 'missing_orpha_coding', resourceId: 'spec-1' }),
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(SampleModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('non-strict mode: proceeds with import when Observation has invalid HPO coding, reporting warning', async () => {
    const bundle = validBundle();
    bundle.entry[2].resource.code.coding = [
      { system: 'http://purl.obolibrary.org/obo/hp.owl', code: '', display: '' },
    ];

    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(200);
    expect(response.body.semanticContract.warnings).toEqual([
      expect.objectContaining({ type: 'invalid_hpo_coding', resourceId: 'obs-1' }),
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(ObservationModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('strict mode: rejects with 422 and does not touch any model when Specimen lacks ORPHA coding', async () => {
    process.env.FHIR_SEMANTIC_STRICT = 'true';

    const bundle = validBundle();
    bundle.entry[1].resource.type.coding = [];

    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(422);
    expect(response.body.error).toBe(
      'Bundle FHIR rejeitado por violacao do contrato semantico (ORPHA/HPO).'
    );
    expect(response.body.semanticContract).toEqual({
      strictMode: true,
      violations: [expect.objectContaining({ type: 'missing_orpha_coding', resourceId: 'spec-1' })],
    });

    expect(PatientModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(SampleModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ObservationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('skips entries with no resource field without error', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [{}, { resource: null }],
    };

    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      imported: 0,
      semanticContract: { strictMode: false, warnings: [] },
    });
    expect(PatientModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('skips entries with unrecognized resourceType', async () => {
    const bundle = {
      resourceType: 'Bundle',
      entry: [{ resource: { resourceType: 'Encounter', id: 'enc-1' } }],
    };

    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(200);
    expect(response.body.imported).toBe(0);
    expect(PatientModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(SampleModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ObservationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('returns 500 and logs error when a model rejects, but still closes the neo4j session', async () => {
    PatientModel.findOneAndUpdate.mockRejectedValue(new Error('DB write failed'));

    const bundle = validBundle();
    const response = await request(app).post('/api/import/fhir-intelligent').send(bundle);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'DB write failed' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });
});
