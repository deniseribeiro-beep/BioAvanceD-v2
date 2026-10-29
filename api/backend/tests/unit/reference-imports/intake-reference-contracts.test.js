const fs = require('fs');
const path = require('path');

/**
 * Cross-check: intake wizard coding contracts ↔ reference-import systemUris
 * (OMIM intentionally excluded from this lab reconciliation slice).
 */
const intakeWizardPath = path.join(__dirname, '../../../src/routes/intakeWizard.js');
const sourcesDir = path.join(__dirname, '../../../src/reference-data/reference-imports/sources');
const fullLabSources = require('../../../src/reference-data/reference-imports/lab/fullLabSources');

const EXPECTED = [
  { code: 'ORPHA', constName: 'ORPHA_SYSTEM_URI', sourceFile: 'orpha.js', intakeField: 'clinicalData.orphaCode' },
  { code: 'ICD10', constName: 'ICD10_SYSTEM_URI', sourceFile: 'icd10.js', intakeField: 'clinicalData.cid' },
  { code: 'HPO', constName: 'HPO_SYSTEM_URI', sourceFile: 'hpo.js', intakeField: 'clinicalData.phenotypes[].hpoId' },
  { code: 'ATC', constName: 'ATC_SYSTEM_URI', sourceFile: 'atc.js', intakeField: 'pharmacologyData.atcCode' },
  { code: 'DCB', constName: 'DCB_SYSTEM_URI', sourceFile: 'dcb.js', intakeField: 'clinicalData.allergies[]' },
  { code: 'LOINC', constName: 'LOINC_OBSERVATION_SYSTEM_URI', sourceFile: 'loinc.js', intakeField: 'clinicalData.observationRecords[].loincCode' },
];

describe('intake ↔ reference contracts (excl. OMIM)', () => {
  const wizardSrc = fs.readFileSync(intakeWizardPath, 'utf8');

  for (const entry of EXPECTED) {
    it(`${entry.code}: systemUri matches sources/${entry.sourceFile} and fullLabSources has a converter or ready JSONL path`, () => {
      const source = require(path.join(sourcesDir, entry.sourceFile));
      const constMatch = wizardSrc.match(new RegExp(`const ${entry.constName}\\s*=\\s*['"]([^'"]+)['"]`));
      expect(constMatch, `${entry.constName} missing in intakeWizard.js`).toBeTruthy();
      expect(constMatch[1]).toBe(source.systemUri);

      const lab = fullLabSources[entry.code];
      expect(lab, `fullLabSources.${entry.code}`).toBeTruthy();
      const convertible = Boolean(lab.convert);
      const jsonlReady = Array.isArray(lab.jsonlCandidates) && lab.jsonlCandidates.length > 0;
      expect(convertible || jsonlReady).toBe(true);
      expect(entry.intakeField).toBeTruthy();
    });
  }

  it('does not require OMIM for this reconciliation slice', () => {
    expect(fullLabSources.OMIM).toBeTruthy();
    expect(EXPECTED.some((e) => e.code === 'OMIM')).toBe(false);
  });
});
