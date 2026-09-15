from pathlib import Path

GOV = Path('api/backend/tests/unit/intakeWizard.governance-integration.test.js')
CLIN = Path('api/backend/tests/unit/intakeWizard.clinicalEntities.test.js')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


def migrate_governance():
    text = GOV.read_text(encoding='utf-8')
    text = replace_once(text, "const storageServicePath = require.resolve('../../src/services/storageService');\n", "const consentServicePath = require.resolve('../../src/services/consent.service');\n", 'governance service path')
    text = replace_once(text, '  storageServicePath,\n', '  consentServicePath,\n', 'governance cache path')

    consent_anchor = """  const qualityDomainModule = require(qualityDomainPath);
  qualityDomainModule.resolveMethodologicalQuality = vi.fn(() => ({
    governance_status: 1,
    final_grade: 'A',
    sprec: {},
    score: 90,
  }));

"""
    consent_insert = consent_anchor + """  const consentServiceModule = require(consentServicePath);
  consentServiceModule.getPatientConsent = vi.fn(async () => consentActive
    ? {
        _id: 'consent-1',
        consentId: 'consent-1',
        participantId: '12345678',
        status: 'ACTIVE',
        signedAt: new Date(),
      }
    : null);

"""
    text = replace_once(text, consent_anchor, consent_insert, 'governance consent seam')

    old_sample = """  const sampleServiceModule = require(sampleServicePath);
  vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

  const StorageService = require(storageServicePath);
  vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
    success: true,
    sampleLocation: { boxId: 'box-1', position: 'A1' },
  });
"""
    new_sample = """  const sampleServiceModule = require(sampleServicePath);
  vi.spyOn(sampleServiceModule, 'createSample').mockImplementation(async (_db, sample) => ({
    _id: 'sample-1',
    specimenId: sample.specimenId || 'spec-1',
    participantId: '12345678',
    currentStoragePlacement: {
      specimenId: sample.specimenId || 'spec-1',
      boxId: String(sample.boxId),
      positionCode: sample.positionCode,
    },
  }));
"""
    text = replace_once(text, old_sample, new_sample, 'governance canonical sample seam')

    for term in ('storageServicePath', 'autoAssignSampleToBox', 'sampleLocation', 'storageLocation', 'StorageAssignment', 'storageAssignment'):
        if term in text:
            raise SystemExit(f'governance retired storage term still present: {term}')
    for required in ('currentStoragePlacement', 'consentServiceModule.getPatientConsent'):
        if required not in text:
            raise SystemExit(f'governance required v2 token missing: {required}')
    GOV.write_text(text, encoding='utf-8')


def migrate_clinical():
    text = CLIN.read_text(encoding='utf-8')
    text = replace_once(text, "const storageServicePath = require.resolve('../../src/services/storageService');\n", "const consentServicePath = require.resolve('../../src/services/consent.service');\n", 'clinical service path')
    text = replace_once(text, '  storageServicePath,\n', '  consentServicePath,\n', 'clinical cache path')

    anchor = """    const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);
    rcsAssessmentServiceModule.recordAssessment = vi.fn().mockResolvedValue({ _id: 'assessment-1' });

"""
    insertion = anchor + """    const consentServiceModule = require(consentServicePath);
    consentServiceModule.getPatientConsent = vi.fn().mockResolvedValue(null);

"""
    text = replace_once(text, anchor, insertion, 'clinical consent seam')

    old_sample = """    const sampleServiceModule = require(sampleServicePath);
    vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });

    const StorageService = require(storageServicePath);
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      sampleLocation: { boxId: 'box-1', position: 'A1' },
    });
"""
    new_sample = """    const sampleServiceModule = require(sampleServicePath);
    vi.spyOn(sampleServiceModule, 'createSample').mockImplementation(async (_db, sample) => ({
      _id: 'sample-1',
      specimenId: sample.specimenId || 'spec-1',
      participantId: '12345678',
      currentStoragePlacement: {
        specimenId: sample.specimenId || 'spec-1',
        boxId: String(sample.boxId),
        positionCode: sample.positionCode,
      },
    }));
"""
    text = replace_once(text, old_sample, new_sample, 'clinical canonical sample seam')

    for term in ('storageServicePath', 'autoAssignSampleToBox', 'sampleLocation', 'storageLocation', 'StorageAssignment', 'storageAssignment'):
        if term in text:
            raise SystemExit(f'clinical retired storage term still present: {term}')
    for required in ('currentStoragePlacement', 'consentServiceModule.getPatientConsent'):
        if required not in text:
            raise SystemExit(f'clinical required v2 token missing: {required}')
    CLIN.write_text(text, encoding='utf-8')


migrate_governance()
migrate_clinical()
Path(__file__).unlink()
