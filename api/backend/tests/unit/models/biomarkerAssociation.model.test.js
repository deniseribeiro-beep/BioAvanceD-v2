import { describe, it, expect } from 'vitest';

// ELM-0275..0285 (#1206): BiomarkerAssociation's fields, its required-field
// rules and its governed systems (ENUM-0096..0100).
const BiomarkerAssociation = require('../../../src/models/BiomarkerAssociation');

const valid = {
  analyte: { systemUri: 'http://www.genenames.org', code: 'HGNC:1100', display: 'BRCA1' },
  associatedCondition: [{ systemUri: 'http://www.orpha.net', code: 'ORPHA:145', display: 'Hereditary breast and ovarian cancer syndrome' }],
  biomarkerRole: 'risk',
  contextOfUse: 'Avaliação de risco hereditário em mulheres com história familiar.',
  evidenceReferences: [{ system: 'DOI', value: '10.1056/NEJMoa1234567' }, { system: 'PMID', value: '12345678' }],
};

const errorsOf = (change) => BiomarkerAssociation.validate({ ...valid, ...change }).errors.join(' | ');

describe('BiomarkerAssociation model (ELM-0275..0285)', () => {
  it('fieldsOf() emits the 11 catalog fields in order, with no timestamps', () => {
    expect(Object.keys(BiomarkerAssociation.fieldsOf())).toEqual([
      'biomarkerId', 'analyte', 'associatedCondition', 'biospecimenMatrix', 'biomarkerRole', 'contextOfUse',
      'assayMethod', 'cutoff', 'evidenceLevel', 'regulatoryStatus', 'evidenceReferences',
    ]);
  });

  it('create({}) does not throw, so the PUT allowlist can be derived from it', () => {
    expect(() => BiomarkerAssociation.create({})).not.toThrow();
  });

  it('accepts a valid association', () => {
    expect(BiomarkerAssociation.validate(valid)).toEqual({ isValid: true, errors: [] });
  });

  it.each([
    ['a missing analyte', { analyte: undefined }, /analyte é obrigatório para BiomarkerAssociation \(1\.\.1\)/],
    ['an empty associatedCondition', { associatedCondition: [] }, /associatedCondition é obrigatório para BiomarkerAssociation \(1\.\.\*\)/],
    ['a condition outside ORPHA, ICD-11 and MONDO', { associatedCondition: [{ systemUri: 'http://snomed.info/sct', code: '254837009' }] }, /associatedCondition.*ORPHA, ICD-11 ou MONDO/],
    ['an unknown biomarkerRole', { biomarkerRole: 'predictive' }, /biomarkerRole deve ser um de diagnostic/],
    ['a blank contextOfUse', { contextOfUse: '   ' }, /contextOfUse é obrigatório para BiomarkerAssociation \(1\.\.1\)/],
    ['an empty evidenceReferences', { evidenceReferences: [] }, /evidenceReferences é obrigatório para BiomarkerAssociation \(1\.\.\*\)/],
    ['an evidence system other than DOI or PMID', { evidenceReferences: [{ system: 'ISBN', value: 'x' }] }, /evidenceReferences.*DOI\|PMID/],
    ['an evidence system sent as an array', { evidenceReferences: [{ system: ['DOI'], value: '10.1234/a' }] }, /evidenceReferences.*DOI\|PMID/],
    ['a malformed DOI', { evidenceReferences: [{ system: 'DOI', value: '11.1/x' }] }, /evidenceReferences.*DOI inválido/],
    ['a PMID with a leading zero', { evidenceReferences: [{ system: 'PMID', value: '0123' }] }, /evidenceReferences.*PMID inválido/],
  ])('refuses %s', (_label, change, message) => {
    expect(BiomarkerAssociation.validate({ ...valid, ...change }).isValid).toBe(false);
    expect(errorsOf(change)).toMatch(message);
  });

  it('normalises biomarkerRole " Diagnostic " to diagnostic and accepts it', () => {
    expect(BiomarkerAssociation.fieldsOf({ biomarkerRole: ' Diagnostic ' }).biomarkerRole).toBe('diagnostic');
    expect(BiomarkerAssociation.validate({ ...valid, biomarkerRole: ' Diagnostic ' }).isValid).toBe(true);
  });
});
