import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { isValidISO8601Duration, iso8601DurationToMs } = require('../../src/utils/iso8601Duration');
const merkleTree = require('../../src/utils/merkleTree');
const AccessModel = require('../../src/models/Access');
const AnalysisTypeModel = require('../../src/models/AnalysisType');
const PermissionModel = require('../../src/models/Permission');
const PhenotypeObservationModel = require('../../src/models/PhenotypeObservation');
const SampleMovementModel = require('../../src/models/SampleMovement');
const { computeCharlsonScore } = require('../../src/services/charlsonComorbidityIndex');
const { buildUserFilterById } = require('../../src/utils/userFilter');
const { streamJsonLines } = require('../../src/reference-data/reference-imports/parseJsonLines');
const { resolveImportIssue } = require('../../src/reference-data/reference-imports/quarantine');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tiny residual branches for item 8', () => {
  it('covers ISO-8601 duration invalid conversion and every supported component', () => {
    expect(isValidISO8601Duration('P1Y2M3W4D')).toBe(true);
    expect(isValidISO8601Duration(123)).toBe(false);
    expect(() => iso8601DurationToMs('invalid')).toThrow('não é uma duração ISO 8601 válida');

    const dayMs = 24 * 60 * 60 * 1000;
    expect(iso8601DurationToMs('P1Y2M3W4D')).toBe((365 + 60 + 21 + 4) * dayMs);
    expect(iso8601DurationToMs('P1D')).toBe(dayMs);
  });

  it('covers Merkle empty-input and odd-leaf proof duplication branches', () => {
    expect(merkleTree.buildMerkleTree()).toEqual({ root: null, layers: [[]] });

    const leaves = ['a', 'b', 'c'];
    const tree = merkleTree.buildMerkleTree(leaves);
    const proof = merkleTree.getProofForIndex(tree.layers, 2);

    expect(proof[0]).toEqual({ position: 'right', hash: 'c' });
    expect(merkleTree.verifyProof('c', proof, tree.root)).toBe(true);
  });

  it('covers AccessModel unknown description and explicit create branches', () => {
    expect(AccessModel.validateAccessType('Desconhecido')).toBeNull();

    const grantedAt = new Date('2026-01-01T00:00:00.000Z');
    const created = AccessModel.create({
      accessID: 'access-1',
      reportID: 0,
      reportType: 'Audit',
      accessType: 4,
      userId: 'user-1',
      grantedAt,
      expiresAt: grantedAt,
    });
    expect(created).toEqual(expect.objectContaining({
      accessID: 'access-1',
      reportID: 0,
      accessType: 4,
      userId: 'user-1',
      grantedAt,
      expiresAt: grantedAt,
    }));
  });

  it('covers AnalysisType slug guard and explicit/default create active branches', () => {
    expect(AnalysisTypeModel.slugify()).toBe('');
    expect(AnalysisTypeModel.slugify(123)).toBe('');
    expect(AnalysisTypeModel.slugify(' Análise  Clínica! ')).toBe('analise_clinica');

    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    expect(AnalysisTypeModel.create({
      name: 'A',
      code: 'a',
      active: false,
      createdAt,
    })).toEqual({
      name: 'A',
      code: 'a',
      active: false,
      createdAt,
    });
    expect(AnalysisTypeModel.create({ name: 'B', code: 'b' }).active).toBe(true);
  });

  it('covers Permission invalid-status branch after otherwise valid fields', () => {
    expect(() => PermissionModel.create({
      permissionCode: 'test.permission',
      resourceType: 'Specimen',
      allowedActions: ['READ'],
      permissionStatus: 'unknown',
    })).toThrow('permissionStatus inválido');
  });

  it('covers PhenotypeObservation non-array evidence and optional default branches', () => {
    const fields = PhenotypeObservationModel.fieldsOf({
      participantId: ' P1 ',
      hpoCoding: { systemUri: 'http://purl.obolibrary.org/obo/hp.owl', code: 'HP:0000001' },
      presenceStatus: ' PRESENT ',
      phenotypeEvidence: 'not-an-array',
      encounterId: '',
      effectiveDateTime: '2026-01-01T00:00:00.000Z',
    });

    expect(fields.phenotypeEvidence).toEqual([]);
    expect(fields.encounterId).toBeNull();
    expect(fields.presenceStatus).toBe('present');
  });

  it('covers SampleMovement falsy condition normalization and counter fallback', async () => {
    expect(SampleMovementModel.normalizeReturnCondition()).toBe('');
    expect(SampleMovementModel.normalizeReturnCondition('ÍNTEGRA')).toBe('intact');

    const db = {
      collection: vi.fn(() => ({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
      })),
    };
    await expect(SampleMovementModel.generateMovementID(db)).resolves.toBe(1);
  });

  it('covers Charlson falsy checklist item without inventing a category', () => {
    expect(computeCharlsonScore([null, '', false])).toEqual({
      scoreValue: null,
      scoreComponents: [],
    });
  });

  it('covers user-filter empty, ObjectId and nonnumeric identifier branches', () => {
    expect(buildUserFilterById()).toEqual({ _id: null });

    const objectId = '507f1f77bcf86cd799439011';
    const valid = buildUserFilterById(objectId);
    expect(valid.$or).toEqual(expect.arrayContaining([
      { _id: expect.anything() },
      { _id: objectId },
      { id: objectId },
      { userID: objectId },
    ]));

    const nonNumeric = buildUserFilterById('user-alpha');
    expect(nonNumeric.$or).toEqual([
      { _id: 'user-alpha' },
      { id: 'user-alpha' },
      { userID: 'user-alpha' },
    ]);
  });

  it('covers blank JSONL rows in the streaming parser', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioadvanced-jsonl-'));
    const file = path.join(dir, 'input.jsonl');
    fs.writeFileSync(file, '\n{"id":1}\n   \n{"id":2}\n', 'utf8');

    try {
      const rows = [];
      for await (const record of streamJsonLines(file)) rows.push(record);
      expect(rows).toEqual([
        { rowNumber: 2, line: '{"id":1}' },
        { rowNumber: 4, line: '{"id":2}' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('covers missing reference-import issue id before touching persistence', async () => {
    await expect(resolveImportIssue({
      db: { collection: vi.fn() },
      referenceImportIssueId: '',
      resolutionStatus: 'closed',
      resolvedBy: 'Actor/curator',
    })).rejects.toThrow('referenceImportIssueId é obrigatório');
  });
});
