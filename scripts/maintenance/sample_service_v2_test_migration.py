from pathlib import Path
import re

path = Path('api/backend/tests/unit/sample.service.test.js')
text = path.read_text(encoding='utf-8')

old = """const sampleService = require('../../src/services/sample.service');
const qualityDomain = require('../../src/services/quality-domain.service');"""
new = """const allocateSampleUseCasePath = require.resolve('../../src/core/use-cases/AllocateSampleUseCase');
const mongoStorageRepositoryPath = require.resolve('../../src/infrastructure/persistence/mongo/MongoStorageRepository');

let currentCanonicalPlacement = null;
let currentAllocateExecute = vi.fn(async () => ({
  success: true,
  currentStoragePlacement: currentCanonicalPlacement,
  lineageQueued: true,
  lineageEventId: 'evt-create-allocation'
}));
let currentFindCurrentStoragePlacement = vi.fn(async () => currentCanonicalPlacement);

function StableAllocateSampleUseCase() {
  this.execute = (...args) => currentAllocateExecute(...args);
}
function StableMongoStorageRepository() {
  this.findCurrentStoragePlacement = (...args) => currentFindCurrentStoragePlacement(...args);
}

require.cache[allocateSampleUseCasePath] = {
  id: allocateSampleUseCasePath,
  filename: allocateSampleUseCasePath,
  loaded: true,
  exports: StableAllocateSampleUseCase
};
require.cache[mongoStorageRepositoryPath] = {
  id: mongoStorageRepositoryPath,
  filename: mongoStorageRepositoryPath,
  loaded: true,
  exports: StableMongoStorageRepository
};

const sampleService = require('../../src/services/sample.service');
const qualityDomain = require('../../src/services/quality-domain.service');"""
if text.count(old) != 1:
    raise SystemExit(f'import seam replacement count={text.count(old)}')
text = text.replace(old, new, 1)

old = "    storageAssignments: makeCollection('storageAssignments'),\n"
if text.count(old) != 1:
    raise SystemExit(f'storageAssignments collection replacement count={text.count(old)}')
text = text.replace(old, '', 1)

pattern = re.compile(r"\n    // #507: AllocateSampleUseCase's findSampleById resolves the canonical\n    // storageAssignment via findOne before the position is even open — no\n    // open assignment exists yet at create time, so this stays null\.\n    storageAssignments: \{\n      insertOne: vi\.fn\(\)\.mockResolvedValue\(\{ insertedId: 'assignment-1' \}\),\n      findOne: vi\.fn\(\)\.mockResolvedValue\(null\)\n    \}\n", re.S)
text, count = pattern.subn('', text)
if count != 1:
    raise SystemExit(f'mock storageAssignments block replacement count={count}')

old = "return Promise.resolve({ _id: query._id, barcode: null, storageLocation: null });"
new = "return Promise.resolve({ _id: query._id, specimenId: String(query._id), barcode: null });"
if text.count(old) != 1:
    raise SystemExit(f'sample lookup snapshot replacement count={text.count(old)}')
text = text.replace(old, new, 1)

old = """  beforeEach(() => {
    vi.restoreAllMocks();
  });"""
new = """  beforeEach(() => {
    vi.restoreAllMocks();
    currentCanonicalPlacement = {
      specimenId: '555001',
      boxId: BOX_ID.toString(),
      positionCode: 'A1',
      storageRackId: RACK_ID.toString(),
      storagePositionId: `${RACK_ID}:A1`
    };
    currentAllocateExecute = vi.fn(async () => ({
      success: true,
      currentStoragePlacement: currentCanonicalPlacement,
      lineageQueued: true,
      lineageEventId: 'evt-create-allocation'
    }));
    currentFindCurrentStoragePlacement = vi.fn(async () => currentCanonicalPlacement);
  });"""
if text.count(old) != 1:
    raise SystemExit(f'beforeEach replacement count={text.count(old)}')
text = text.replace(old, new, 1)

old = """      // #474: AllocateSampleUseCase's audit repository appends its own
      // 'allocate' movement to the same ledger, alongside the birth
      // 'create' movement createSample already wrote — two inserts, not one.
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(2);
      const movementTypes = db.collections.sample_movements.insertOne.mock.calls.map(([arg]) => arg.type);
      expect(movementTypes).toEqual(['create', 'allocate']);"""
new = """      // This unit isolates SampleService: the canonical allocation use case is
      // doubled here and its own immutable audit/outbox behavior is covered
      // by AllocateSampleUseCase + storage integration tests.
      expect(db.collections.sample_movements.insertOne).toHaveBeenCalledTimes(1);"""
if text.count(old) != 1:
    raise SystemExit(f'movement assertion replacement count={text.count(old)}')
text = text.replace(old, new, 1)

pattern = re.compile(
    r"\n    it\('persists the resolved storageLocation \(boxId/positionCode\) on the created sample, per issue #462',[\s\S]*?\n    it\('rejects with 422 when required MIABIS fields are missing'",
    re.M
)
replacement = """
    it('keeps physical custody out of the Sample document and exposes currentStoragePlacement as a read model', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentCanonicalPlacement = {
        specimenId: '555001',
        boxId: BOX_ID.toString(),
        positionCode: 'B2',
        storageRackId: RACK_ID.toString(),
        storagePositionId: `${RACK_ID}:B2`
      };

      const result = await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }));
      const [insertedSample] = db.collections.samples.insertOne.mock.calls[0];

      expect(Object.prototype.hasOwnProperty.call(insertedSample, 'storageLocation')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(insertedSample, 'storageAssignment')).toBe(false);
      expect(result.currentStoragePlacement).toEqual(currentCanonicalPlacement);
      expect(result.locationID).toBeUndefined();
    });

    it('delegates initial physical custody to AllocateSampleUseCase using the canonical box/position command', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentCanonicalPlacement = {
        specimenId: '555001',
        boxId: BOX_ID.toString(),
        positionCode: 'B2',
        storageRackId: RACK_ID.toString(),
        storagePositionId: `${RACK_ID}:B2`
      };

      await sampleService.createSample(db, validSampleData({ positionCode: 'B2' }), {
        auditInfo: { userId: 'user-1', userName: 'Tester', userRole: 'Coordenador' }
      });

      expect(currentAllocateExecute).toHaveBeenCalledWith(expect.objectContaining({
        specimenId: 'generated-id',
        boxId: BOX_ID.toString(),
        position: 'B2',
        actor: expect.objectContaining({ userId: 'user-1', userName: 'Tester', userRole: 'Coordenador' })
      }));
      expect(currentFindCurrentStoragePlacement).toHaveBeenCalledWith('555001');
    });

    it('removes the newborn Sample when canonical allocation fails instead of leaving split custody state', async () => {
      const db = makeDb();
      mockOperationalStorage(db);
      currentAllocateExecute = vi.fn(async () => { throw new Error('STORAGE_COLLISION: position occupied'); });

      await expect(sampleService.createSample(db, validSampleData())).rejects.toMatchObject({ statusCode: 409 });
      expect(db.collections.samples.deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });

    it('rejects with 422 when required MIABIS fields are missing'"""
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'legacy createSample test block replacement count={count}')

text = text.replace(
    "does not persist a client-supplied legacy location object (#400 — severed in favor of storageLocation/storageBoxes)",
    "does not persist a client-supplied legacy location object (#400 — canonical placement is normalized outside Sample)"
)

for retired in ('storageAssignments', 'storageAssignment', 'StorageAssignment', 'storageLocation'):
    if retired in text:
        raise SystemExit(f'retired storage term still present in sample.service.test.js: {retired}')

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
