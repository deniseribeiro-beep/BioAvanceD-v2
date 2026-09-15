from pathlib import Path
import re

INTAKE = Path('api/backend/tests/unit/intakeWizard.routes.test.js')
IMPORT = Path('api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def migrate_intake() -> None:
    text = INTAKE.read_text(encoding='utf-8')

    text = replace_once(
        text,
        "const storageServicePath = require.resolve('../../src/services/storageService');\n",
        '',
        'intake storageServicePath import'
    )
    text = replace_once(
        text,
        '  storageServicePath,\n',
        '',
        'intake storageServicePath cache entry'
    )

    # The route no longer calls StorageService.autoAssignSampleToBox; createSample
    # already returns the canonical currentStoragePlacement read model. Remove the
    # stale spies instead of translating their old sampleLocation payload.
    spy_pattern = re.compile(
        r"\n(?P<i>[ \t]*)const StorageService = require\(storageServicePath\);\n"
        r"(?P=i)vi\.spyOn\(StorageService\.prototype, 'autoAssignSampleToBox'\)\.mockResolvedValue\(\{\n"
        r"(?P=i)  success: true,\n"
        r"(?P=i)  sampleLocation: \{ boxId: '[^']+', position: '[^']+' \},\n"
        r"(?P=i)\}\);\n"
    )
    text, spy_count = spy_pattern.subn('\n', text)
    if spy_count < 10:
        raise SystemExit(f'intake stale auto-allocation spy count too low: {spy_count}')

    text = replace_once(
        text,
        "    // #511: sample.service.js#createSample (#510) additively exposes the\n"
        "    // canonical StorageAssignment on its return value alongside the legacy\n"
        "    // storageLocation field. intakeWizard's own response builder (lines\n"
        "    // ~579-609) must forward it the same way, not just the legacy shape it\n"
        "    // reconstructs from local box/position variables.\n"
        "    it('exposes the canonical storageAssignment on the response, per #510 (#511)', async () => {",
        "    // The intake response must expose the same canonical placement returned by\n"
        "    // SampleService, enriched only with readable topology metadata. No physical\n"
        "    // custody snapshot is embedded back into the Sample document.\n"
        "    it('exposes currentStoragePlacement from the canonical v2 read model', async () => {",
        'intake legacy canonical-placement test header'
    )

    text = replace_once(
        text,
        "      const canonicalStorageAssignment = {\n"
        "        _id: 'assignment-1',\n"
        "        sampleId: 'sample-1',\n"
        "        boxId: 'box-1',\n"
        "        position: 'A1',\n"
        "        status: 'ACTIVE',\n"
        "      };",
        "      const canonicalStoragePlacement = {\n"
        "        specimenId: 'spec-1',\n"
        "        boxId: 'box-1',\n"
        "        positionCode: 'A1',\n"
        "        storageRackId: 'rack-1',\n"
        "        storagePositionId: 'rack-1:A1',\n"
        "      };",
        'intake canonical placement fixture'
    )
    text = replace_once(
        text,
        "        storageAssignment: canonicalStorageAssignment,",
        "        currentStoragePlacement: canonicalStoragePlacement,",
        'intake createSample canonical placement property'
    )
    text = replace_once(
        text,
        "      expect(res.body.storageAssignment).toEqual(canonicalStorageAssignment);\n"
        "      expect(res.body.storageLocation).toBeTruthy();",
        "      expect(res.body.currentStoragePlacement).toMatchObject(canonicalStoragePlacement);\n"
        "      expect(res.body.currentStoragePlacement).toMatchObject({\n"
        "        boxName: 'Box A',\n"
        "        equipmentID: 'EQ-1',\n"
        "      });\n"
        "      expect(res.body.sample.currentStoragePlacement).toEqual(res.body.currentStoragePlacement);",
        'intake canonical placement expectations'
    )

    retired = ('StorageAssignment', 'storageAssignment', 'storageLocation', 'sampleLocation', 'storageServicePath', 'autoAssignSampleToBox')
    for term in retired:
        if term in text:
            raise SystemExit(f'intake retired storage term still present: {term}')
    if 'currentStoragePlacement' not in text:
        raise SystemExit('intake currentStoragePlacement coverage missing')

    INTAKE.write_text(text, encoding='utf-8')


def migrate_import() -> None:
    text = IMPORT.read_text(encoding='utf-8')

    seam = """const allocateSampleUseCasePath = require.resolve('../../src/core/use-cases/AllocateSampleUseCase');
let currentAllocateExecute = vi.fn(async () => ({
  success: true,
  currentStoragePlacement: null,
  lineageQueued: true,
  lineageEventId: 'evt-import-allocation',
}));

function StableAllocateSampleUseCase() {
  this.execute = (...args) => currentAllocateExecute(...args);
}

require.cache[allocateSampleUseCasePath] = {
  id: allocateSampleUseCasePath,
  filename: allocateSampleUseCasePath,
  loaded: true,
  exports: StableAllocateSampleUseCase,
};

"""
    marker = "const service = require('../../src/services/import-lgpd.service');\n"
    if marker not in text:
        raise SystemExit('import service require marker missing')
    if 'allocateSampleUseCasePath' not in text:
        text = text.replace(marker, seam + marker, 1)

    text = replace_once(
        text,
        "  // AllocateSampleUseCase's audit trail (MongoAuditRepository) and\n"
        "  // storagePaths hierarchy lookup (MongoStorageRepository.openStorageAssignment).\n",
        "  // Sample movement fixtures remain here for import-ledger behavior. Physical\n"
        "  // custody itself is delegated to the canonical AllocateSampleUseCase seam below.\n",
        'import legacy repository comment'
    )

    assignment_block = re.compile(
        r"\n      const storageAssignments = \[\];\n"
        r"      const storageAssignmentsCollection = \{[\s\S]*?\n      \};\n"
    )
    text, count = assignment_block.subn('\n', text, count=1)
    if count != 1:
        raise SystemExit(f'import storageAssignments fixture block replacement count={count}')

    text = replace_once(
        text,
        "        if (name === 'storageAssignments') return storageAssignmentsCollection;\n",
        '',
        'import storageAssignments collection branch'
    )
    text = replace_once(
        text,
        "      base.storageAssignments = storageAssignments;\n",
        '',
        'import storageAssignments exported fixture'
    )
    text = replace_once(
        text,
        "      const { db, samplesCollection, storageAssignments } = makeDbWithStorageChain(chain);",
        "      const { db, samplesCollection } = makeDbWithStorageChain(chain);",
        'import storageAssignments destructuring'
    )

    before_each_old = """  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);"""
    before_each_new = """  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());
    currentAllocateExecute = vi.fn(async () => ({
      success: true,
      currentStoragePlacement: null,
      lineageQueued: true,
      lineageEventId: 'evt-import-allocation',
    }));

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);"""
    text = replace_once(text, before_each_old, before_each_new, 'import beforeEach allocation seam reset')

    text = replace_once(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));\n"
        "      expect(inserted.storageLocation.position).toBe('A1');\n"
        "      expect(storageAssignments).toHaveLength(1);",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({\n"
        "        specimenId: 'sample-id-1',\n"
        "        boxId: String(chain.boxes[0]._id),\n"
        "        position: 'A1',\n"
        "      }));",
        'import autoIncrement canonical allocation assertions'
    )
    text = replace_once(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({\n"
        "        specimenId: 'sample-id-1',\n"
        "        boxId: String(chain.boxes[0]._id),\n"
        "        position: 'A1',\n"
        "      }));",
        'import fixed start box canonical allocation assertions'
    )
    text = replace_once(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[1]._id));",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({\n"
        "        specimenId: 'sample-id-1',\n"
        "        boxId: String(chain.boxes[1]._id),\n"
        "        position: 'A1',\n"
        "      }));",
        'import CSV box canonical allocation assertions'
    )

    retired = ('StorageAssignment', 'storageAssignment', 'storageAssignments', 'storageLocation', 'sampleLocation', 'graphPersisted')
    for term in retired:
        if term in text:
            raise SystemExit(f'import retired storage term still present: {term}')
    if 'currentAllocateExecute' not in text or 'currentStoragePlacement' not in text:
        raise SystemExit('import canonical allocation coverage missing')

    IMPORT.write_text(text, encoding='utf-8')


migrate_intake()
migrate_import()
Path(__file__).unlink()
