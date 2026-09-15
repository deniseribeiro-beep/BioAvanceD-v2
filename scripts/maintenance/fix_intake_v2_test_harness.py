from pathlib import Path
import re

path = Path('api/backend/tests/unit/intakeWizard.routes.test.js')
text = path.read_text(encoding='utf-8')


def one(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

# Deterministic test-only key: the patient-match tests exercise real
# encrypt/decrypt + blind-index behavior. Without a key they are not testing
# the ciphertext-only v2 contract at all.
one(
    "const require = createRequire(import.meta.url);\n",
    "const require = createRequire(import.meta.url);\n\n"
    "process.env.ENCRYPTION_KEY = 'bioavanced-intake-wizard-unit-test-key';\n"
    "process.env.ENCRYPTION_KEY_ID = 'intake-wizard-test-key';\n",
    'test encryption key'
)

# Consent governance is a collaborator of this ROUTE unit. Its normalized
# persistence is covered by ConsentGovernanceV2Repository/service tests; the
# intake unit should drive its public read contract instead of rebuilding the
# old mutable-consent collection fixture.
one(
    "const rcsAssessmentServicePath = require.resolve('../../src/services/rcs-assessment.service');\n",
    "const rcsAssessmentServicePath = require.resolve('../../src/services/rcs-assessment.service');\n"
    "const consentServicePath = require.resolve('../../src/services/consent.service');\n",
    'consent service path'
)
one(
    "  rcsAssessmentServicePath,\n  routePath,\n",
    "  rcsAssessmentServicePath,\n  consentServicePath,\n  routePath,\n",
    'consent service cache entry'
)

one(
    "const VALID_PAYLOAD = {",
    "let currentPatientConsent = null;\n\nconst VALID_PAYLOAD = {",
    'current patient consent state'
)

one(
    "  resolveMethodologicalQuality,\n} = {}) {",
    "  resolveMethodologicalQuality,\n  getPatientConsent,\n} = {}) {",
    'loadRoute consent argument'
)

one(
    "  const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);\n"
    "  rcsAssessmentServiceModule.recordAssessment = vi.fn().mockResolvedValue({ _id: 'assessment-1' });\n\n"
    "  const router = require(routePath);",
    "  const rcsAssessmentServiceModule = require(rcsAssessmentServicePath);\n"
    "  rcsAssessmentServiceModule.recordAssessment = vi.fn().mockResolvedValue({ _id: 'assessment-1' });\n\n"
    "  const consentServiceModule = require(consentServicePath);\n"
    "  consentServiceModule.getPatientConsent = getPatientConsent || vi.fn(async () => currentPatientConsent);\n\n"
    "  const router = require(routePath);",
    'consent service seam'
)

one(
    "  afterEach(() => {\n    vi.restoreAllMocks();\n    clearCache();\n  });",
    "  afterEach(() => {\n    currentPatientConsent = null;\n    vi.restoreAllMocks();\n    clearCache();\n  });",
    'consent reset'
)

# The historical helper encoded ACTIVE/REVOKED as findOne call ordering. Keep
# the scenario inputs readable while translating them to the v2 service view.
old_helper = """    function buildHappyPathDb({ sensorsFind, equipmentFindOne, storageBoxesFind, storageContainersFindOne, consentsFindOneQueue } = {}) {
      const consentsCollection = {
        findOne: consentsFindOneQueue
          ? vi.fn(() => Promise.resolve(consentsFindOneQueue.shift() ?? null))
          : vi.fn().mockResolvedValue(null),
      };
"""
new_helper = """    function buildHappyPathDb({ sensorsFind, equipmentFindOne, storageBoxesFind, storageContainersFindOne, consentsFindOneQueue } = {}) {
      const consentCandidates = Array.isArray(consentsFindOneQueue) ? [...consentsFindOneQueue] : [];
      const consentCandidate = consentCandidates.find(Boolean) || null;
      currentPatientConsent = consentCandidate
        ? {
            ...consentCandidate,
            consentId: consentCandidate.consentId || String(consentCandidate._id || ''),
            status: consentCandidates[0] === null ? 'REVOKED' : (consentCandidate.status || 'ACTIVE'),
          }
        : null;
      const consentsCollection = { findOne: vi.fn().mockResolvedValue(null) };
"""
one(old_helper, new_helper, 'canonical consent helper')

# This assertion belonged to the removed mutable-consent query. The route's
# responsibility is the governance decision it receives, not repository query
# shape, so assert the public result instead.
legacy_consent_assert = re.compile(
    r"\n      expect\(consentsCollection\.findOne\)\.toHaveBeenCalledWith\([\s\S]*?\n      \);",
    re.M,
)
text, count = legacy_consent_assert.subn(
    "\n      expect(res.body.consent.consentId).toBe('consent-1');",
    text,
    count=1,
)
if count != 1:
    raise SystemExit(f'legacy consent query assertion replacement count={count}')

# Most historical route tests mocked createSample without its now-required v2
# read model because a second StorageService mock used to provide the physical
# result. The second call is gone. Return the canonical placement directly from
# SampleService, derived from the command the route passed to it.
old_sample_mock = "vi.spyOn(sampleServiceModule, 'createSample').mockResolvedValue({ _id: 'sample-1', participantId: '12345678' });"
new_sample_mock = """vi.spyOn(sampleServiceModule, 'createSample').mockImplementation(async (_db, sample) => ({
        _id: 'sample-1',
        specimenId: sample.specimenId || 'spec-1',
        participantId: '12345678',
        currentStoragePlacement: {
          specimenId: sample.specimenId || 'spec-1',
          boxId: String(sample.boxId),
          positionCode: sample.positionCode,
        },
      }));"""
sample_mock_count = text.count(old_sample_mock)
if sample_mock_count < 6:
    raise SystemExit(f'expected multiple simple createSample mocks, found {sample_mock_count}')
text = text.replace(old_sample_mock, new_sample_mock)

# Guard the migrated storage semantics plus the harness contract.
for retired in ('StorageAssignment', 'storageAssignment', 'storageLocation', 'sampleLocation', 'autoAssignSampleToBox', 'storageServicePath'):
    if retired in text:
        raise SystemExit(f'intake retired storage term reintroduced: {retired}')
for required in ('currentStoragePlacement', 'consentServiceModule.getPatientConsent', 'ENCRYPTION_KEY'):
    if required not in text:
        raise SystemExit(f'intake required v2 harness token missing: {required}')

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
