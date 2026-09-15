from pathlib import Path
import re

INTAKE = Path('api/backend/tests/unit/intakeWizard.routes.test.js')
IMPORT = Path('api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js')
OLD_SCRIPT = Path('scripts/maintenance/migrate_remaining_storage_v2_tests.py')


def one(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


def migrate_intake():
    text = INTAKE.read_text(encoding='utf-8')
    text = one(text, "const storageServicePath = require.resolve('../../src/services/storageService');\n", '', 'storage service path')
    text = one(text, '  storageServicePath,\n', '', 'storage service cache entry')

    spy_pattern = re.compile(
        r"\n(?P<i>[ \t]*)const StorageService = require\(storageServicePath\);\n"
        r"(?P=i)vi\.spyOn\(StorageService\.prototype, 'autoAssignSampleToBox'\)\.mockResolvedValue\(\{\n"
        r"(?P=i)  success: true,\n"
        r"(?P=i)  sampleLocation: \{ boxId: '[^']+', position: '[^']+' \},\n"
        r"(?P=i)\}\);\n"
    )
    text, spy_count = spy_pattern.subn('\n', text)
    if spy_count < 10:
        raise SystemExit(f'expected at least 10 stale StorageService spies, found {spy_count}')

    text = one(
        text,
        "    // #511: sample.service.js#createSample (#510) additively exposes the\n"
        "    // canonical StorageAssignment on its return value alongside the legacy\n"
        "    // storageLocation field. intakeWizard's own response builder (lines\n"
        "    // ~579-609) must forward it the same way, not just the legacy shape it\n"
        "    // reconstructs from local box/position variables.\n"
        "    it('exposes the canonical storageAssignment on the response, per #510 (#511)', async () => {",
        "    // Intake exposes the canonical v2 placement read model returned by\n"
        "    // SampleService and enriches it only with readable topology metadata.\n"
        "    it('exposes currentStoragePlacement from the canonical v2 read model', async () => {",
        'legacy placement test header'
    )
    text = one(
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
        'canonical placement fixture'
    )
    text = one(text, '        storageAssignment: canonicalStorageAssignment,', '        currentStoragePlacement: canonicalStoragePlacement,', 'canonical placement response property')
    text = one(
        text,
        "      expect(res.body.storageAssignment).toEqual(canonicalStorageAssignment);\n"
        "      expect(res.body.storageLocation).toBeTruthy();",
        "      expect(res.body.currentStoragePlacement).toMatchObject(canonicalStoragePlacement);\n"
        "      expect(res.body.currentStoragePlacement).toMatchObject({ boxName: 'Box A', equipmentID: 'EQ-1' });\n"
        "      expect(res.body.sample.currentStoragePlacement).toEqual(res.body.currentStoragePlacement);",
        'canonical placement expectations'
    )

    # Remaining tests exercised automatic box selection but still asserted the
    # retired response alias. Keep the scenarios; point them at the v2 DTO.
    text = text.replace('res.body.storageLocation.position', 'res.body.currentStoragePlacement.positionCode')
    text = text.replace('res.body.storageLocation', 'res.body.currentStoragePlacement')

    for term in ('StorageAssignment', 'storageAssignment', 'storageLocation', 'sampleLocation', 'storageServicePath', 'autoAssignSampleToBox'):
        if term in text:
            raise SystemExit(f'intake retired term still present: {term}')
    INTAKE.write_text(text, encoding='utf-8')


def migrate_import():
    text = IMPORT.read_text(encoding='utf-8')
    marker = "const service = require('../../src/services/import-lgpd.service');\n"
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
    if 'allocateSampleUseCasePath' not in text:
        if marker not in text:
            raise SystemExit('import service marker missing')
        text = text.replace(marker, seam + marker, 1)

    text = one(
        text,
        "  // AllocateSampleUseCase's audit trail (MongoAuditRepository) and\n"
        "  // storagePaths hierarchy lookup (MongoStorageRepository.openStorageAssignment).\n",
        "  // Physical custody is delegated to AllocateSampleUseCase; its normalized\n"
        "  // chain/audit/outbox behavior is covered by the storage integration suite.\n",
        'legacy repository comment'
    )

    block = re.compile(r"\n      const storageAssignments = \[\];\n      const storageAssignmentsCollection = \{[\s\S]*?\n      \};\n")
    text, count = block.subn('\n', text, count=1)
    if count != 1:
        raise SystemExit(f'storage assignment fixture block count={count}')
    text = one(text, "        if (name === 'storageAssignments') return storageAssignmentsCollection;\n", '', 'storage assignment branch')
    text = one(text, '      base.storageAssignments = storageAssignments;\n', '', 'storage assignment fixture export')
    text = one(text, '      const { db, samplesCollection, storageAssignments } = makeDbWithStorageChain(chain);', '      const { db, samplesCollection } = makeDbWithStorageChain(chain);', 'storage assignment destructuring')

    old_before = """  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);"""
    new_before = """  beforeEach(() => {
    ({ db, samplesCollection, patientsCollection, rcsAssessmentsCollection, specimenPreanalyticsCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());
    currentAllocateExecute = vi.fn(async () => ({
      success: true,
      currentStoragePlacement: null,
      lineageQueued: true,
      lineageEventId: 'evt-import-allocation',
    }));

    vi.spyOn(patientIdentityService, 'matchOrUpsertParticipant').mockResolvedValue(MATCHED_PATIENT);"""
    text = one(text, old_before, new_before, 'allocation seam reset')

    text = one(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));\n"
        "      expect(inserted.storageLocation.position).toBe('A1');\n"
        "      expect(storageAssignments).toHaveLength(1);",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'sample-id-1', boxId: String(chain.boxes[0]._id), position: 'A1' }));",
        'auto increment placement assertions'
    )
    text = one(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[0]._id));",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'sample-id-1', boxId: String(chain.boxes[0]._id), position: 'A1' }));",
        'fixed placement assertions'
    )
    text = one(
        text,
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(String(inserted.storageLocation.boxId)).toBe(String(chain.boxes[1]._id));",
        "      const inserted = samplesCollection.insertOne.mock.calls[0][0];\n"
        "      expect(inserted.currentStoragePlacement).toBeUndefined();\n"
        "      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({ specimenId: 'sample-id-1', boxId: String(chain.boxes[1]._id), position: 'A1' }));",
        'CSV placement assertions'
    )

    for term in ('StorageAssignment', 'storageAssignment', 'storageAssignments', 'storageLocation', 'sampleLocation', 'graphPersisted'):
        if term in text:
            raise SystemExit(f'import retired term still present: {term}')
    IMPORT.write_text(text, encoding='utf-8')


migrate_intake()
migrate_import()
OLD_SCRIPT.unlink(missing_ok=True)
Path(__file__).unlink()
