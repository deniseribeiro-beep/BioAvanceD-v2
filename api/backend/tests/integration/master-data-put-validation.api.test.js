import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1400: PUT /:id on every createMasterDataRouter mount validates the stored
// row merged with the edit, as POST validates a create. Without it an edit
// could store a record the model refuses at create (an ImagingStudy with
// `series: []`). accessType 4 is global, so it also clears Assay's
// laboratoryId scope.

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const MOUNTS = [
  {
    path: '/api/measurement-units',
    collection: 'measurementUnits',
    stored: { unitID: 1, description: 'mL' },
    refusedEdit: { description: '' },
    error: 'description é obrigatório',
    validEdit: { description: 'Mililitro' },
  },
  {
    path: '/api/quality-descriptions',
    collection: 'qualityDescriptions',
    stored: { id: 'GOOD', description: 'Boa' },
    refusedEdit: { description: '' },
    error: 'description é obrigatório',
    validEdit: { description: 'Boa qualidade' },
  },
  {
    path: '/api/sample-types',
    collection: 'sampleTypes',
    stored: { id: 'PLASMA', description: 'Plasma' },
    refusedEdit: { description: '' },
    error: 'description é obrigatório',
    validEdit: { description: 'Plasma X' },
  },
  {
    path: '/api/sample-origins',
    collection: 'sampleOrigins',
    stored: { id: 'VB', description: 'Sangue' },
    refusedEdit: { description: '' },
    error: 'description é obrigatório',
    validEdit: { description: 'Sangue X' },
  },
  {
    path: '/api/extraction-protocols',
    collection: 'extractionProtocols',
    stored: { id: 'EDTA', description: 'Tubo' },
    refusedEdit: { description: '' },
    error: 'description é obrigatório',
    validEdit: { description: 'Tubo X' },
  },
  {
    path: '/api/studies',
    collection: 'studies',
    stored: { studyId: 's1', studyTitle: 'T', ethicsApprovalId: ['e1'] },
    refusedEdit: { ethicsApprovalId: [] },
    error: 'ethicsApprovalId é obrigatório',
    validEdit: { studyTitle: 'T2' },
  },
  {
    path: '/api/protocols',
    collection: 'protocols',
    stored: {
      protocolId: 'p1',
      protocolName: 'P',
      protocolType: 'SOP',
      protocolVersion: '1.0',
      documentUri: 'https://example.org/p.pdf',
      effectivePeriod: { start: '2026-01-01' },
    },
    refusedEdit: { protocolVersion: '' },
    error: 'protocolVersion',
    validEdit: { protocolName: 'P2' },
  },
  {
    path: '/api/assays',
    collection: 'assays',
    stored: {
      assayId: 'a1',
      studyId: 'study-1',
      specimenIds: ['specimen-1'],
      assayType: 'RNA sequencing',
      protocolId: 'protocol-1',
      operatorId: 'user-1',
      laboratoryId: 'org-1',
      assayDateTime: '2026-08-19T10:00:00.000Z',
      intendedUse: 'RNA-seq discovery',
    },
    refusedEdit: { specimenIds: [] },
    error: 'specimenIds é obrigatório',
    validEdit: { intendedUse: 'x' },
  },
  {
    path: '/api/reagent-lots',
    collection: 'reagentLots',
    stored: {
      reagentId: 'r1',
      reagentName: 'RNA Extraction Kit',
      lotNumber: 'LOT-2026-001',
      manufacturer: 'Qiagen',
      catalogNumber: 'CAT-12345',
      expirationDate: '2027-08-19T00:00:00.000Z',
      storageCondition: '-20C',
    },
    refusedEdit: { lotNumber: '' },
    error: 'lotNumber',
    validEdit: { manufacturer: 'M2' },
  },
  {
    path: '/api/datasets',
    collection: 'datasets',
    stored: {
      datasetId: 'd1',
      datasetTitle: 'RNA-seq cohort 2026',
      datasetVersion: '1.0.0',
      creators: [{ name: 'Dr. Silva', orcid: '0000-0000-0000-0001' }],
      license: 'CC-BY-4.0',
    },
    refusedEdit: { creators: [] },
    error: 'creators',
    validEdit: { datasetTitle: 'D2' },
  },
  {
    path: '/api/collections',
    collection: 'collections',
    stored: { collectionId: 'c1', collectionName: 'C', governanceRegime: 'biobank' },
    refusedEdit: { collectionName: '' },
    error: 'collectionName',
    validEdit: { collectionName: 'C2' },
  },
  {
    path: '/api/biobanks',
    collection: 'biobanks',
    stored: {
      biobankId: 'b1',
      biobankName: 'Biobanco Sintético',
      biobankDescription: 'Biobanco de teste',
      legalEntityId: 'org-1',
      biobankStatus: 'active',
      countryCode: 'br',
      contactInformation: { email: 'contato@example.org' },
    },
    refusedEdit: { biobankName: '' },
    error: 'biobankName',
    validEdit: { biobankName: 'Novo' },
  },
  {
    path: '/api/networks',
    collection: 'networks',
    stored: {
      networkId: 'n1',
      name: 'Rede Sintética',
      description: 'Rede de teste',
      juristicPerson: 'org-1',
      networkStatus: 'active',
      countryCodes: ['BR'],
      contactInformation: { email: 'rede@example.org' },
    },
    refusedEdit: { name: '' },
    error: 'name',
    validEdit: { name: 'Novo' },
  },
  {
    path: '/api/identifier-namespaces',
    collection: 'identifierNamespaceRegistries',
    stored: {
      identifierNamespaceRegistryId: 'ns-1',
      namespaceKey: 'specimen',
      systemUri: 'https://id.bioadvanced.dev/ns/specimen',
      authorityDomain: 'bioadvanced.dev',
      targetTypes: ['specimen'],
      semanticVersion: '1.0.0',
      status: 'active',
      effectivePeriod: { start: '2026-01-01' },
      configurationReleaseId: 'cfg-2026-10',
    },
    refusedEdit: { targetTypes: [] },
    error: 'targetTypes',
    validEdit: { semanticVersion: '1.1.0' },
  },
  {
    path: '/api/workflow-runs',
    collection: 'workflowRuns',
    stored: {
      workflowRunId: 'w1',
      workflowId: 'variant-calling-pipeline',
      workflowVersion: '2.3.1',
      createdBy: 'User/user-1',
      startedAt: '2026-08-21T10:00:00.000Z',
      runStatus: 'succeeded',
      hardwareProfile: { cpu: 'synthetic', gpu: null },
      environmentManifestUri: 'object://synthetic/environment.json',
    },
    refusedEdit: { runStatus: 'not-a-status' },
    error: 'runStatus deve ser um de',
    validEdit: { workflowVersion: '2.0' },
  },
  {
    path: '/api/omics-qualifications',
    collection: 'omicsQualifications',
    stored: {
      omicsQualificationId: 'q1',
      targetAssay: 'RNA-seq',
      qcRuleSetVersion: 'RNA_QC_1.0',
      qcMetrics: [{ metric: 'RIN', value: 8.2 }],
      qualificationDecision: 'eligible',
    },
    refusedEdit: { qcRuleSetVersion: '' },
    error: 'qcRuleSetVersion',
    validEdit: { limitations: 'l' },
  },
  {
    path: '/api/omics-runs',
    collection: 'omicsRuns',
    stored: {
      omicsRunId: 'o1',
      modality: 'genomics',
      referenceAssembly: 'GRCh38',
      fileLinks: [{ role: 'read', fileId: 'file-1' }],
    },
    refusedEdit: { modality: 'nope' },
    error: 'modality deve ser um de',
    validEdit: { modality: 'proteomics' },
  },
  {
    path: '/api/imaging-studies',
    collection: 'imagingStudies',
    stored: {
      imagingStudyId: 'i1',
      dicomStudyUid: '1.2.840.113619.2.55.3.604688119.969',
      series: [{ uid: '1.2.840.113619.2.55.3.604688119.970', modality: 'CT', numberOfInstances: 1 }],
    },
    refusedEdit: { series: [] },
    error: 'series é obrigatório',
    validEdit: { dicomStudyUid: '1.2.3' },
  },
];

function givenStoredRow(collection, stored) {
  const coll = createCollectionMock({
    findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', ...stored }),
    findOneAndUpdate: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', ...stored }),
    // The identifier-namespaces reference check lists the namespaceKey's rows.
    find: vi.fn(() => ({ toArray: async () => [] })),
  });
  app.locals.db = createDbMock({ [collection]: coll, ...rbacCollectionsAdmin });
  return coll;
}

describe.each(MOUNTS)('PUT $path/:id (#1400)', ({ path, collection, stored, refusedEdit, error, validEdit }) => {
  it('refuses an edit that makes the record invalid and writes nothing', async () => {
    const coll = givenStoredRow(collection, stored);

    const res = await request(app)
      .put(`${path}/rec-1`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(refusedEdit);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.details.some((detail) => detail.includes(error))).toBe(true);
    expect(coll.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('CONTROL: accepts a valid partial edit', async () => {
    const coll = givenStoredRow(collection, stored);

    const res = await request(app)
      .put(`${path}/rec-1`)
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send(validEdit);

    expect(res.status).toBe(200);
    expect(coll.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
