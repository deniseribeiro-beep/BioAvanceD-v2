import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { validate } = require('../../src/contracts/canonical/v1');

const baseIntake = {
  participant: { participantId: 'p1' },
  consent: {},
  specimen: { specimenId: 's1', participantId: 'p1' },
  clinical: {},
  biomarkers: []
};

describe('canonical.v1.intake diagnosis sub-schema', () => {
  it('accepts explicit null for optional diagnosis string fields (issue #169)', () => {
    const { valid, errors } = validate('canonical.v1.intake', {
      ...baseIntake,
      diagnosis: {
        diagnosisName: null,
        icdCode: 'E70.0',
        orphaCode: 'ORPHA:123',
        omimCode: null,
        definition: null
      }
    });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('canonical.v1.intake specimen.parentSpecimenIds (dict-02 ELM-0120, #1371)', () => {
  const withParents = (parentSpecimenIds) => ({
    ...baseIntake,
    specimen: { ...baseIntake.specimen, parentSpecimenIds }
  });

  it('accepts a list of parent specimen ids', () => {
    const { valid, errors } = validate('canonical.v1.intake', withParents(['SP-1', 'SP-2']));

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('accepts a specimen that names no parent', () => {
    const { valid, errors } = validate('canonical.v1.intake', baseIntake);

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it.each([
    ['a single string', 'SP-1'],
    ['an empty id', ['']],
    ['a duplicate id', ['SP-1', 'SP-1']]
  ])('rejects %s', (_label, parentSpecimenIds) => {
    const { valid, errors } = validate('canonical.v1.intake', withParents(parentSpecimenIds));

    expect(valid).toBe(false);
    expect(errors.some((error) => error.instancePath.startsWith('/specimen/parentSpecimenIds'))).toBe(true);
  });
});

describe('canonical.v1.intake organizationId (#1376)', () => {
  it('accepts a top-level organizationId string, the organization the intake stamps', () => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, organizationId: 'org-a' });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('rejects a non-string organizationId', () => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, organizationId: 42 });

    expect(valid).toBe(false);
    expect(errors.some((error) => error.instancePath === '/organizationId')).toBe(true);
  });
});

describe('canonical.v1.intake participant (#1318)', () => {
  // canonical.v1.participant takes clinicalUnitId and consentTemplateId for
  // ingestion; the intake keeps its organization and template elsewhere.
  it('canonical.v1.participant accepts a clinicalUnitId and a consentTemplateId', () => {
    const { valid, errors } = validate('canonical.v1.participant', { participantId: 'p1', clinicalUnitId: 'org-1', consentTemplateId: 'tpl-1' });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it.each(['clinicalUnitId', 'consentTemplateId'])('rejects an intake whose participant carries %s', (field) => {
    const { valid } = validate('canonical.v1.intake', { ...baseIntake, participant: { participantId: 'p1', [field]: 'x-1' } });

    expect(valid).toBe(false);
  });
});

describe('canonical.v1.intake consent (#1318)', () => {
  // canonical.v1.consent takes participantId and responses for ingestion;
  // the intake takes its participant from participant and records no
  // responses.
  it('canonical.v1.consent accepts a participantId and boolean responses', () => {
    const { valid, errors } = validate('canonical.v1.consent', {
      participantId: '12345678',
      consentTemplateId: 'tpl-1',
      responses: { storage: true, recontact: false },
      consentGranted: true,
      consentAcceptedAt: '2026-10-01T09:00:00.000Z',
    });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('canonical.v1.consent accepts the supersedesConsentId of the consent in force it supersedes', () => {
    const { valid, errors } = validate('canonical.v1.consent', { participantId: '12345678', supersedesConsentId: 'consent-prior' });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('canonical.v1.consent rejects a non-boolean response', () => {
    const { valid } = validate('canonical.v1.consent', { participantId: '12345678', responses: { storage: 'yes' } });

    expect(valid).toBe(false);
  });

  it.each([
    ['participantId', '12345678'],
    ['responses', { storage: true }],
    ['supersedesConsentId', 'consent-prior'],
  ])('rejects an intake whose consent carries %s', (field, value) => {
    const { valid } = validate('canonical.v1.intake', { ...baseIntake, consent: { consentGranted: true, [field]: value } });

    expect(valid).toBe(false);
  });

  it('still accepts an intake whose consent carries the template, the grant and its time', () => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, consent: { consentTemplateId: 'tpl-1', consentGranted: true, consentAcceptedAt: '2026-10-01T09:00:00.000Z' } });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

describe('canonical.v1.intake governanceEvidence (RNF018 AC5, #1524)', () => {
  it('accepts a top-level governanceEvidence object', () => {
    const { valid, errors } = validate('canonical.v1.intake', {
      ...baseIntake,
      governanceEvidence: { documentation: [{ uri: 'urn:bioavanced:collection-governance-approval:A1', hash: `sha256:${'a'.repeat(64)}` }] }
    });

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it.each([
    ['an array', []],
    ['a string', 'urn:bioavanced:collection-governance-approval:A1'],
    ['null', null]
  ])('rejects a governanceEvidence that is %s', (_label, governanceEvidence) => {
    const { valid, errors } = validate('canonical.v1.intake', { ...baseIntake, governanceEvidence });

    expect(valid).toBe(false);
    expect(errors.some((error) => error.instancePath === '/governanceEvidence')).toBe(true);
  });

  it('rejects a top-level governanceEvidenceResolution', () => {
    const { valid } = validate('canonical.v1.intake', { ...baseIntake, governanceEvidenceResolution: {} });

    expect(valid).toBe(false);
  });
});
