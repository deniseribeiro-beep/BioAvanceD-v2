import { describe, it, expect } from 'vitest';
const { SampleModel: Sample } = require('../../src/models/Sample');

describe('Sample.create - collectionSite (ELM-0128)', () => {
  const base = {
    specimenId: 'SP-1',
    participantId: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    registeredAt: new Date('2024-01-01'),
    quantity: 10,
    linkedProject: 'ProjectX'
  };

  it('maps collectionSite (Organization reference) onto the created document', () => {
    const result = Sample.create({ ...base, collectionSite: 'org-uuid-123' });
    expect(result.collectionSite).toBe('org-uuid-123');
  });

  it('defaults collectionSite to null when not provided', () => {
    const result = Sample.create({ ...base });
    expect(result.collectionSite).toBeNull();
  });

  // #1192: the tenancy key, separate from the collection site.
  it("a create ignores a caller's organizationId and stores null", () => {
    const result = Sample.create({ ...base, organizationId: 'org-custodian', collectionSite: 'org-partner' });
    expect(result.organizationId).toBeNull();
    expect(result.collectionSite).toBe('org-partner');
  });

  it('defaults organizationId to null when not provided', () => {
    const result = Sample.create({ ...base, collectionSite: 'org-partner' });
    expect(result.organizationId).toBeNull();
  });
});

describe('Sample.validateSpecimenStatus', () => {
  it('returns true for available', () => {
    expect(Sample.validateSpecimenStatus('available')).toBe(true);
  });

  // RF006 AC2: the operational states only.
  it('returns true for all valid statuses', () => {
    ['available', 'reserved', 'checked_out', 'quarantined', 'unavailable', 'closed'].forEach(s => {
      expect(Sample.validateSpecimenStatus(s)).toBe(true);
    });
  });

  it('returns false for the v1.3.0 quantity and disposition values (RF006 AC2)', () => {
    ['partial', 'depleted', 'destroyed', 'disposed'].forEach(s => {
      expect(Sample.validateSpecimenStatus(s)).toBe(false);
    });
  });

  it('returns false for unknown status', () => {
    expect(Sample.validateSpecimenStatus('BOGUS')).toBe(false);
    expect(Sample.validateSpecimenStatus(null)).toBe(false);
    expect(Sample.validateSpecimenStatus('')).toBe(false);
  });
});

// #413: import/FHIR write sites map their legacy lifecycleStatus vocabulary
// onto specimenStatus through this helper instead of constructing the trio.
describe('Sample.mapLegacyLifecycleStatusToSpecimenStatus', () => {
  it('case-folds a directly-mapping legacy value', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('AVAILABLE')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('QUARANTINED')).toBe('quarantined');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('checked_out')).toBe('checked_out');
  });

  // V2E-0544: v1.3.0 values fold onto the v2 set; an imported row never
  // lands closed (RF026 AC7).
  it('folds v1.3.0 values per the migration mapping, and closed to unavailable', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('partial')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('DEPLETED')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('destroyed')).toBe('unavailable');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('disposed')).toBe('unavailable');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('closed')).toBe('unavailable');
  });

  it('folds REGISTERED into available (no dict-02 equivalent)', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('REGISTERED')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('registered')).toBe('available');
  });

  it('defaults to available for blank or unrecognized input', () => {
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('')).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus(null)).toBe('available');
    expect(Sample.mapLegacyLifecycleStatusToSpecimenStatus('Withdrawn')).toBe('available');
  });
});

// RF006 AC3, dictionary RULE-003..005: quantityStatus is derived from the
// quantities; specimenStatus no longer moves with them.
describe('Sample.computeQuantityStatus', () => {
  it('returns depleted when currentQuantity <= 0 (RULE-005)', () => {
    expect(Sample.computeQuantityStatus(10, 0)).toBe('depleted');
    expect(Sample.computeQuantityStatus(10, -1)).toBe('depleted');
    expect(Sample.computeQuantityStatus(10, null)).toBe('depleted');
  });

  it('returns partial when 0 < current < initial (RULE-004)', () => {
    expect(Sample.computeQuantityStatus(10, 5)).toBe('partial');
  });

  it('returns full when current equals initial (RULE-003)', () => {
    expect(Sample.computeQuantityStatus(10, 10)).toBe('full');
  });

  it('returns full when initialQuantity is 0 or current exceeds it', () => {
    expect(Sample.computeQuantityStatus(0, 5)).toBe('full');
    expect(Sample.computeQuantityStatus(10, 12)).toBe('full');
  });

  it('is gone as a specimenStatus derivation: computeStatus no longer exists', () => {
    expect(Sample.computeStatus).toBeUndefined();
  });
});

describe('Sample.resolveQuantityStatus', () => {
  it('returns a stored value', () => {
    expect(Sample.resolveQuantityStatus({ quantityStatus: 'partial', initialQuantity: 10, currentQuantity: 10 })).toBe('partial');
  });

  it('derives from the quantities when absent, falling back to quantity', () => {
    expect(Sample.resolveQuantityStatus({ initialQuantity: 10, currentQuantity: 0 })).toBe('depleted');
    expect(Sample.resolveQuantityStatus({ initialQuantity: 10, currentQuantity: 4 })).toBe('partial');
    expect(Sample.resolveQuantityStatus({ quantity: 7 })).toBe('full');
  });
});

// Legacy-read fallback: a document the migration has not reached reads in
// the v2 set.
describe('Sample.resolveSpecimenStatus (legacy folding)', () => {
  it('folds partial and depleted to available, destroyed and disposed to unavailable', () => {
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'partial' })).toBe('available');
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'depleted' })).toBe('available');
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'destroyed' })).toBe('unavailable');
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'DISPOSED' })).toBe('unavailable');
  });

  it('keeps v2 values and defaults a missing one to available', () => {
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'closed' })).toBe('closed');
    expect(Sample.resolveSpecimenStatus({ specimenStatus: 'Reserved' })).toBe('reserved');
    expect(Sample.resolveSpecimenStatus({})).toBe('available');
  });

  it('treats closed and not-yet-migrated destroyed/disposed as terminal', () => {
    expect(Sample.isTerminalSpecimen({ specimenStatus: 'closed' })).toBe(true);
    expect(Sample.isTerminalSpecimen({ specimenStatus: 'destroyed' })).toBe(true);
    expect(Sample.isTerminalSpecimen({ specimenStatus: 'disposed' })).toBe(true);
    expect(Sample.isTerminalSpecimen({ specimenStatus: 'unavailable' })).toBe(false);
  });
});

describe('Sample.create and Sample.validate (RF006 AC2/AC3, RF026 AC7)', () => {
  const base = {
    specimenId: 'SP-1', participantId: '12345678', sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA', registeredAt: new Date('2024-01-01'), quantity: 10, linkedProject: 'ProjectX',
  };

  it('derives quantityStatus at creation, ignoring a value the caller sent', () => {
    expect(Sample.create({ ...base }).quantityStatus).toBe('full');
    expect(Sample.create({ ...base, currentQuantity: 4, quantityStatus: 'full' }).quantityStatus).toBe('partial');
  });

  it('folds a v1.3.0 status at creation', () => {
    expect(Sample.create({ ...base, specimenStatus: 'depleted' }).specimenStatus).toBe('available');
  });

  it('refuses a registered closed, a v1.3.0 value and a client quantityStatus', () => {
    expect(Sample.validate({ ...base, specimenStatus: 'closed' }).errors).toContain('specimenStatus closed não pode ser atribuído no cadastro');
    expect(Sample.validate({ ...base, specimenStatus: 'partial' }).errors).toContain('specimenStatus inválido');
    expect(Sample.validate({ ...base, quantityStatus: 'full' }).errors).toContain('quantityStatus é derivado das quantidades e não pode ser informado');
    expect(Sample.validate({ ...base, specimenStatus: 'reserved' }).isValid).toBe(true);
  });
});

describe('Sample parentSpecimenIds (ELM-0120, #1368)', () => {
  const base = {
    specimenId: 'SP-1', participantId: '12345678', sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA', registeredAt: new Date('2024-01-01'), quantity: 10, linkedProject: 'ProjectX',
  };

  it('create carries the parents trimmed, without duplicates', () => {
    expect(Sample.create({ ...base, parentSpecimenIds: [' SP-0 ', 'SP-0', 'SP-9'] }).parentSpecimenIds)
      .toStrictEqual(['SP-0', 'SP-9']);
  });

  it('create defaults the parents to an empty list', () => {
    expect(Sample.create({ ...base }).parentSpecimenIds).toStrictEqual([]);
  });

  it('validate accepts a list of specimenIds and an absent field', () => {
    expect(Sample.validate({ ...base, parentSpecimenIds: ['SP-0'] }).isValid).toBe(true);
    expect(Sample.validate({ ...base }).isValid).toBe(true);
  });

  it('validate refuses a non-array, an empty entry and the sample itself', () => {
    expect(Sample.validate({ ...base, parentSpecimenIds: 'SP-0' }).errors).toContain('parentSpecimenIds deve ser uma lista');
    expect(Sample.validate({ ...base, parentSpecimenIds: ['SP-0', '  '] }).errors).toContain('parentSpecimenIds deve conter apenas specimenIds não vazios');
    expect(Sample.validate({ ...base, parentSpecimenIds: ['SP-1'] }).errors).toContain('parentSpecimenIds não pode conter a própria amostra');
  });
});

describe('Sample specimenRole (ELM-0121)', () => {
  const base = {
    specimenId: 'SP-1', participantId: '12345678', sampleType: 'PLASMA', sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA', registeredAt: new Date('2024-01-01'), quantity: 10, linkedProject: 'ProjectX',
  };

  it('create defaults to primary without parents', () => {
    expect(Sample.create({ ...base }).specimenRole).toBe('primary');
  });

  it('create defaults to derivative with parents', () => {
    expect(Sample.create({ ...base, parentSpecimenIds: ['SP-0'] }).specimenRole).toBe('derivative');
  });

  it('create keeps a given role, folded', () => {
    expect(Sample.create({ ...base, parentSpecimenIds: ['SP-0'], specimenRole: 'aliquot' }).specimenRole).toBe('aliquot');
    expect(Sample.create({ ...base, parentSpecimenIds: ['SP-0'], specimenRole: ' Aliquot ' }).specimenRole).toBe('aliquot');
  });

  it('validate accepts a pool without parents and an aliquot with one', () => {
    expect(Sample.validate({ ...base, specimenRole: 'pool' }).isValid).toBe(true);
    expect(Sample.validate({ ...base, specimenRole: 'aliquot', parentSpecimenIds: ['SP-0'] }).isValid).toBe(true);
  });

  it('validate refuses an unknown role', () => {
    expect(Sample.validate({ ...base, specimenRole: 'mother' }).errors).toContain('specimenRole inválido');
  });

  it('validate refuses a primary with parents', () => {
    expect(Sample.validate({ ...base, specimenRole: 'primary', parentSpecimenIds: ['SP-0'] }).errors)
      .toContain('specimenRole primary não pode ter parentSpecimenIds');
  });

  it('validate refuses a control with parents', () => {
    expect(Sample.validate({ ...base, specimenRole: 'control', parentSpecimenIds: ['SP-0'] }).errors)
      .toContain('specimenRole control não pode ter parentSpecimenIds');
  });

  it('validate refuses a derivative without parents', () => {
    expect(Sample.validate({ ...base, specimenRole: 'derivative' }).errors)
      .toContain('specimenRole derivative exige parentSpecimenIds');
  });

  it('resolveSpecimenRole reads the stored role, else derives it from the parents', () => {
    expect(Sample.resolveSpecimenRole({})).toBe('primary');
    expect(Sample.resolveSpecimenRole({ parentSpecimenIds: ['SP-0'] })).toBe('derivative');
    expect(Sample.resolveSpecimenRole({ specimenRole: 'control' })).toBe('control');
    expect(Sample.resolveSpecimenRole({ specimenRole: 'bogus' })).toBe('primary');
  });
});

describe('Sample.validateWithdrawalType', () => {
  it('returns true for Parcial', () => {
    expect(Sample.validateWithdrawalType('Parcial')).toBe(true);
  });

  it('returns true for Total', () => {
    expect(Sample.validateWithdrawalType('Total')).toBe(true);
  });

  it('returns false for unknown type', () => {
    expect(Sample.validateWithdrawalType('Complete')).toBe(false);
    expect(Sample.validateWithdrawalType(null)).toBe(false);
  });
});

describe('Sample.validateResponsibleName', () => {
  it('returns true for full name with space', () => {
    expect(Sample.validateResponsibleName('João Silva')).toBe(true);
  });

  it('returns false for single word', () => {
    expect(Sample.validateResponsibleName('João')).toBe(false);
  });

  it('returns false for null', () => {
    expect(Sample.validateResponsibleName(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(Sample.validateResponsibleName('')).toBe(false);
  });

  it('returns true for two single-letter words (word-count check only)', () => {
    expect(Sample.validateResponsibleName('J S')).toBe(true);
  });
});

describe('Sample.validate', () => {
  const { SAMPLE_ORIGIN_IDS, EXTRACTION_PROTOCOL_IDS, SPECIMEN_TYPE_IDS } = require('../../src/config/constants/specimen.constants');
  const validData = {
    specimenId: 'SPEC-001',
    participantId: '12345678',
    sampleType: SPECIMEN_TYPE_IDS[0],
    sampleOrigin: SAMPLE_ORIGIN_IDS[0],
    extractionProtocol: EXTRACTION_PROTOCOL_IDS[0],
    quantity: 10,
    unit: 'mL',
    quality: 'GOOD',
    linkedProject: 'PROJ-001',
    registeredAt: new Date().toISOString(),
  };

  it('returns no errors for valid data', () => {
    const result = Sample.validate(validData);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when participantId is missing', () => {
    const { participantId: _, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('participantId'))).toBe(true);
  });

  it('returns error when specimenId is missing', () => {
    const { specimenId: _, ...data } = validData;
    const result = Sample.validate(data);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('specimenId'))).toBe(true);
  });
});
