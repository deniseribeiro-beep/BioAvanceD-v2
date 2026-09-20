import { afterEach, describe, expect, it, vi } from 'vitest';

const router = require('../../src/interface/routes/reports.routes');
const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
const rcsAssessmentService = require('../../src/services/rcs-assessment.service');

const h = router._test;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reports.routes helper residual branches', () => {
  it('normalizes report ids and generated dates through all fallbacks', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    expect(h.normalizeReport({ reportID: '7', generatedAt: createdAt })).toMatchObject({
      reportID: 7,
      generatedAt: createdAt,
    });
    expect(h.normalizeReport({ reportID: null, createdAt })).toMatchObject({
      reportID: 0,
      generatedAt: createdAt,
    });
    expect(h.normalizeReport({}).generatedAt).toBeInstanceOf(Date);
  });

  it('resolves the first usable collection and falls back to the first candidate', () => {
    const patients = {};
    const db = {
      collection: vi.fn((name) => {
        if (name === 'broken') throw new Error('missing');
        if (name === 'patients') return patients;
        return null;
      }),
    };
    expect(h.resolveCollection(db, ['broken', 'patients'])).toBe(patients);

    const fallbackDb = {
      collection: vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ fallback: true }),
    };
    expect(h.resolveCollection(fallbackDb, ['a', 'b'])).toEqual({ fallback: true });
  });

  it('increments report ids from empty and populated collections', async () => {
    const collection = {
      find: vi.fn(() => ({
        sort: () => ({
          limit: () => ({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        }),
      })),
    };
    await expect(h.nextReportId(collection)).resolves.toBe(1);

    collection.find.mockReturnValueOnce({
      sort: () => ({
        limit: () => ({
          toArray: vi.fn().mockResolvedValue([{ reportID: '9' }]),
        }),
      }),
    });
    await expect(h.nextReportId(collection)).resolves.toBe(10);
  });

  it('normalizes template codes from camelCase, accents and punctuation', () => {
    expect(h.toTemplateCode('samplesByPatient')).toBe('samples_by_patient');
    expect(h.toTemplateCode(' Relatório Clínico ')).toBe('relatorio_clinico');
    expect(h.toTemplateCode('access%20logs')).toBe('access_logs');
    expect(h.toTemplateCode(null)).toBe('');
  });

  it('builds date queries for start-only, end-only, both and empty filters', () => {
    expect(h.buildDateQuery({})).toBeNull();

    const start = h.buildDateQuery({ startDate: '2026-01-02' });
    expect(start.$gte).toEqual(new Date('2026-01-02'));

    const end = h.buildDateQuery({ endDate: '2026-01-02' });
    expect(end.$lte.getHours()).toBe(23);
    expect(end.$lte.getMinutes()).toBe(59);

    const both = h.buildDateQuery({ startDate: '2026-01-01', endDate: '2026-01-02' });
    expect(both.$gte).toBeInstanceOf(Date);
    expect(both.$lte).toBeInstanceOf(Date);
  });

  it('covers text/regex/truthy/status normalizers and unknown passthroughs', () => {
    expect(h.normalizeFilterText(null)).toBe('');
    expect(h.normalizeFilterText(' x ')).toBe('x');
    expect(h.escapeRegex('a+b?')).toBe('a\\+b\\?');
    expect(h.toRegex('A+B').test('a+b')).toBe(true);

    for (const value of ['true', '1', 'yes', 'sim', ' YES ']) {
      expect(h.isTruthyFilter(value)).toBe(true);
    }
    expect(h.isTruthyFilter('false')).toBe(false);

    expect(h.normalizeReleaseStatus('')).toBe('');
    expect(h.normalizeReleaseStatus('disponível')).toBe('AVAILABLE');
    expect(h.normalizeReleaseStatus('em quarentena')).toBe('QUARANTINE');
    expect(h.normalizeReleaseStatus('depleted')).toBe('BLOCKED');
    expect(h.normalizeReleaseStatus('custom state')).toBe('CUSTOM_STATE');

    expect(h.normalizeTreatmentStatus('')).toBe('');
    expect(h.normalizeTreatmentStatus('inicial')).toBe('NAIVE');
    expect(h.normalizeTreatmentStatus('em tratamento')).toBe('ON_TREATMENT');
    expect(h.normalizeTreatmentStatus('lavagem')).toBe('WASHOUT');
    expect(h.normalizeTreatmentStatus('custom')).toBe('CUSTOM');

    expect(h.releaseStatusToSpecimenStatus('AVAILABLE')).toBe('available');
    expect(h.releaseStatusToSpecimenStatus('QUARANTINE')).toBe('quarantined');
    expect(h.releaseStatusToSpecimenStatus('BLOCKED')).toBe('unavailable');
    expect(h.releaseStatusToSpecimenStatus('CUSTOM')).toBe('custom');
    expect(h.normalizeSprecCode(' ab ')).toBe('AB');
  });

  it('builds an empty sample query when no filters are active', async () => {
    await expect(h.buildSampleQuery({}, {})).resolves.toEqual({});
  });

  it('builds clinical/pharmacology/release/date/collection/type/origin/org filters together', async () => {
    const query = await h.buildSampleQuery({}, {
      orphaCode: 'ORPHA:123',
      drug: 'ATC:A10',
      treatmentStatus: 'treated',
      status: 'quarantine',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      collection: 'COL-1',
      specimenType: 'plasma',
      origin: 'venous_blood',
      organizationScope: {
        scope: 'organization',
        organizationIds: ['ORG-1'],
      },
    });

    expect(query.$and).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'pharmacologyData.treatmentStatus': 'ON_TREATMENT' }),
      { specimenStatus: 'quarantined' },
      { collectionId: 'COL-1' },
      { sampleType: 'PLASMA' },
      { sampleOrigin: 'VENOUS_BLOOD' },
      { collectionSite: { $in: ['ORG-1'] } },
    ]));
    expect(query.$and.some((part) => Array.isArray(part.$or) && part.$or.some((x) => x['clinicalData.orphaCode']))).toBe(true);
    expect(query.$and.some((part) => Array.isArray(part.$or) && part.$or.some((x) => x.registeredAt))).toBe(true);
  });

  it('uses canonical preanalytics and RCS services for SPREC and quality filters', async () => {
    const pre = vi.spyOn(specimenPreanalyticsService, 'findSpecimenIdsWithCurrentProfileMatching')
      .mockResolvedValue(['S1', 'S2']);
    const rcs = vi.spyOn(rcsAssessmentService, 'findSpecimenIdsWithCurrentAssessmentMatching')
      .mockResolvedValue(['S2']);

    const query = await h.buildSampleQuery({}, {
      sprecMatrixType: ' Fluid ',
      sprecSampleType: ' ser ',
      sprecPrimaryContainer: ' edta ',
      sprecPreCentrifugation: ' a ',
      sprecCentrifugation: ' b ',
      sprecSecondCentrifugation: ' c ',
      sprecPostCentrifugationDelay: ' d ',
      sprecLongTermStorage: ' e ',
      qualityCategory: ' a ',
    });

    expect(pre).toHaveBeenCalledWith({}, {
      matrixType: 'fluid',
      sampleType: 'SER',
      primaryContainer: 'EDTA',
      preCentrifugation: 'A',
      centrifugation: 'B',
      secondCentrifugation: 'C',
      postCentrifugationDelay: 'D',
      longTermStorage: 'E',
    });
    expect(rcs).toHaveBeenCalledWith({}, { finalGrade: 'A' });
    expect(query.$and).toEqual([
      { specimenId: { $in: ['S1', 'S2'] } },
      { specimenId: { $in: ['S2'] } },
    ]);
  });

  it('uses empty id arrays when canonical SPREC/RCS lookup returns null', async () => {
    vi.spyOn(specimenPreanalyticsService, 'findSpecimenIdsWithCurrentProfileMatching')
      .mockResolvedValue(null);
    vi.spyOn(rcsAssessmentService, 'findSpecimenIdsWithCurrentAssessmentMatching')
      .mockResolvedValue(null);

    const query = await h.buildSampleQuery({}, {
      sprecMatrix: 'fluid',
      sprecCategory: 'b',
    });

    expect(query.$and).toEqual([
      { specimenId: { $in: [] } },
      { specimenId: { $in: [] } },
    ]);
  });

  it('returns matching patient ids only for active sample queries and cleans blank values', async () => {
    const collection = {
      distinct: vi.fn().mockResolvedValue([' P1 ', '', null, 2]),
    };
    await expect(h.getMatchingPatientIds(collection, {})).resolves.toEqual([]);
    expect(collection.distinct).not.toHaveBeenCalled();

    await expect(h.getMatchingPatientIds(collection, { specimenStatus: 'available' }))
      .resolves.toEqual(['P1', '2']);

    collection.distinct.mockResolvedValueOnce('not-an-array');
    await expect(h.getMatchingPatientIds(collection, { x: 1 })).resolves.toEqual([]);
  });

  it('builds the stable unknown-report shape', () => {
    expect(h.unknownTypeResult('Custom%20Type')).toEqual({
      total: 0,
      message: 'Tipo de relatório disponível, mas sem pré-visualização específica para este formato.',
      type: 'custom type',
    });
  });

  it('exports CSV using the allow-listed catalog and escapes quotes/null values', () => {
    expect(h.toCsvRows({}, 'patient')).toBe('total,message\n0,"Sem dados para exportação"');
    expect(h.toCsvRows({ patients: [] }, 'patient')).toBe('total,message\n0,"Sem dados para exportação"');
    expect(h.toCsvRows({ unknown: [{ a: 1 }] }, 'missing')).toBe('total,message\n0,"Sem dados para exportação"');

    const csv = h.toCsvRows({
      patients: [{
        participantId: 'P"1',
        sex: null,
        clinicalUnitId: 'ORG-1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
      }],
    }, 'patient');

    expect(csv).toContain('"P""1"');
    expect(csv).toContain('""');
    expect(csv.split('\n')).toHaveLength(2);
  });
});
