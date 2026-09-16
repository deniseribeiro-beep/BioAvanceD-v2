from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace(path, old, new, required=True, count=-1):
    text = read(path)
    if old in text:
        write(path, text.replace(old, new, count))
        return
    if new in text:
        return
    if required:
        raise SystemExit(f"expected snippet not found in {path}: {old[:160]!r}")


# Cold-chain production: canonical specimen identity throughout.
p = "api/backend/src/services/equipment-sensor-quarantine.service.js"
replace(p, "    const sampleId = String(sample._id);", "    const specimenId = String(sample.specimenId || sample._id);")
replace(p, "      specimenIds: [sampleId],", "      specimenIds: [specimenId],")
replace(
    p,
    "        movementID,\n        sampleID: sampleId,",
    "        movementId: movementID,\n        specimenId,",
)

# Cold-chain unit fixtures: normalized physical chain and canonical specimenId.
p = "api/backend/tests/unit/cold-chain-quarantine.service.test.js"
text = read(p)
marker = "function seedStorageHierarchy(collections, containerID) {"
helper = """function seedCanonicalPlacement(collections, boxId, specimenId, positionCode = 'A1') {
  const storageRackId = String(boxId);
  const storagePositionId = `${storageRackId}:${String(positionCode).toUpperCase()}`;
  const containerId = `container:${specimenId}`;
  collections.containers = makeCollection([{ containerId, status: 'active' }]);
  collections.storageRacks = makeCollection([{ storageRackId, status: 'active' }]);
  collections.storagePositions = makeCollection([{ storagePositionId, storageRackId, positionCode: String(positionCode).toUpperCase(), status: 'available' }]);
  collections.containerPositionAssignments = makeCollection([{ containerPositionAssignmentId: `cpa:${specimenId}`, containerId, storagePositionId, assignmentStatus: 'active' }]);
  collections.specimenContainerAssignments = makeCollection([{ specimenContainerAssignmentId: `sca:${specimenId}`, specimenId, containerId, assignmentStatus: 'active' }]);
  collections.rackLocationAssignments = makeCollection([]);
}

"""
if "function seedCanonicalPlacement(" not in text:
    if marker not in text:
        raise SystemExit("cold-chain hierarchy marker not found")
    text = text.replace(marker, helper + marker, 1)
text = text.replace(
    "quarentena amostra vinculada por sensor -> storageLocation.boxId e registra movimento",
    "quarentena amostra vinculada por sensor -> cadeia fisica v2 e registra movimento",
)
text = text.replace(
    "    const { boxId } = seedStorageHierarchy(collections, 9001);\n    collections.samples = makeCollection([{\n      _id: new ObjectId(),\n      sampleID: 'BIO-SAMPLE-001',\n      barcode: 'BC-COLD-001',\n      storageLocation: { boxId, position: 'A1' },\n      status: 'AVAILABLE',\n      currentStatus: 'Available',\n      availabilityStatus: 'AVAILABLE',",
    "    const { boxId } = seedStorageHierarchy(collections, 9001);\n    const specimenId = 'BIO-SAMPLE-001';\n    seedCanonicalPlacement(collections, boxId, specimenId);\n    collections.samples = makeCollection([{\n      _id: new ObjectId(),\n      specimenId,\n      barcode: 'BC-COLD-001',\n      specimenStatus: 'available',",
)
text = text.replace(
    "    const { boxId } = seedStorageHierarchy(collections, 9100);\n    collections.samples = makeCollection([{\n      _id: new ObjectId(),\n      sampleID: 'BIO-SAMPLE-002',\n      barcode: 'BC-COLD-002',\n      storageLocation: { boxId, position: 'A1' },\n      status: 'AVAILABLE',\n      currentStatus: 'Available',",
    "    const { boxId } = seedStorageHierarchy(collections, 9100);\n    const specimenId = 'BIO-SAMPLE-002';\n    seedCanonicalPlacement(collections, boxId, specimenId);\n    collections.samples = makeCollection([{\n      _id: new ObjectId(),\n      specimenId,\n      barcode: 'BC-COLD-002',\n      specimenStatus: 'available',",
)
text = text.replace(
    "    const { boxId } = seedStorageHierarchy(collections, 66);\n    collections.samples = makeCollection([{ _id: new ObjectId(), storageLocation: { boxId, position: 'A1' }, status: 'AVAILABLE', quantity: 2 }]);",
    "    const { boxId } = seedStorageHierarchy(collections, 66);\n    const specimenId = 'BIO-SESSION-2';\n    seedCanonicalPlacement(collections, boxId, specimenId);\n    collections.samples = makeCollection([{ _id: new ObjectId(), specimenId, specimenStatus: 'available', quantity: 2 }]);",
)
text = text.replace(
    "    const { boxId } = seedStorageHierarchy(collections, 55);\n    collections.samples = makeCollection([{ _id: new ObjectId(), storageLocation: { boxId, position: 'A1' }, status: 'AVAILABLE' }]);",
    "    const { boxId } = seedStorageHierarchy(collections, 55);\n    const specimenId = 'BIO-QTY-55';\n    seedCanonicalPlacement(collections, boxId, specimenId);\n    collections.samples = makeCollection([{ _id: new ObjectId(), specimenId, specimenStatus: 'available' }]);",
)
write(p, text)

# Equipment/sensor unit fixtures isolate canonical physical resolution.
p = "api/backend/tests/unit/equipment-sensor-quarantine.service.test.js"
text = read(p)
import_anchor = "const SampleMovementModel = require('../../src/models/SampleMovement');\n"
if "NormalizedPhysicalStorageStore" not in text:
    text = text.replace(
        import_anchor,
        import_anchor
        + "const NormalizedPhysicalStorageStore = require('../../src/infrastructure/persistence/mongo/NormalizedPhysicalStorageStore');\n",
    )
text = text.replace(
    "      const sample = {\n        _id: 'S1',\n        barcode: 'BC-1',\n        currentQuantity: 5,\n        unit: 'mL',\n        storageLocation: { boxId, position: 'A1' }\n      };",
    "      const sample = {\n        _id: 'S1',\n        specimenId: 'SPEC-S1',\n        barcode: 'BC-1',\n        currentQuantity: 5,\n        unit: 'mL',\n        specimenStatus: 'available'\n      };\n      vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findSpecimenIdsByLocation').mockResolvedValue(['SPEC-S1']);",
)
text = text.replace(
    "            { 'storageLocation.boxId': { $in: [boxId] } },",
    "            { specimenId: { $in: ['SPEC-S1'] } },",
)
text = text.replace("          specimenIds: ['S1'],", "          specimenIds: ['SPEC-S1'],")
text = text.replace("          sampleID: 'S1',", "          specimenId: 'SPEC-S1',")
text = text.replace(
    "      const sample = { _id: 'S9', quantity: 3 };",
    "      const sample = { _id: 'S9', specimenId: 'SPEC-S9', specimenStatus: 'available', quantity: 3 };\n      vi.spyOn(NormalizedPhysicalStorageStore.prototype, 'findSpecimenIdsByLocation').mockResolvedValue(['SPEC-S9']);",
)
write(p, text)

# Incidents integration: canonical physical assignments instead of Sample.storageLocation.
p = "api/backend/tests/integration/incidents.api.node.test.js"
text = read(p)
text = text.replace(
    "// filters samples on storageLocation.boxId -- the direct successor to\n// #430's now-retired `locations`-collection lookup this fixture used to\n// seed.",
    "// resolves the affected specimen through the normalized v2 physical chain.\n// No embedded Sample.storageLocation compatibility path is seeded.",
)
text = text.replace(
    "    sampleID: 'BIO-INC-001',\n    barcode: 'BC-INC-001',\n    storageLocation: { boxId: BOX_ID, position: 'A1' },\n    status: 'AVAILABLE',\n    currentStatus: 'Available',\n    availabilityStatus: 'AVAILABLE',",
    "    specimenId: 'BIO-INC-001',\n    barcode: 'BC-INC-001',\n    specimenStatus: 'available',",
)
anchor = "  const samplesCollection = {\n"
normalized = """  const storagePositionsCollection = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
      { storagePositionId: `${BOX_ID}:A1`, storageRackId: String(BOX_ID), positionCode: 'A1' },
    ]) })),
  };
  const containerPositionAssignmentsCollection = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
      { containerId: 'container:BIO-INC-001', storagePositionId: `${BOX_ID}:A1`, assignmentStatus: 'active' },
    ]) })),
  };
  const specimenContainerAssignmentsCollection = {
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([
      { specimenId: 'BIO-INC-001', containerId: 'container:BIO-INC-001', assignmentStatus: 'active' },
    ]) })),
  };
  const emptyCanonicalCollection = () => ({
    createIndex: vi.fn().mockResolvedValue('idx'),
    find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
  });

"""
if "const storagePositionsCollection =" not in text:
    if anchor not in text:
        raise SystemExit("incidents samples collection anchor missing")
    text = text.replace(anchor, normalized + anchor, 1)
old = "      const boxIdFilter = filter?.$and?.find((clause) => clause?.['storageLocation.boxId'])?.['storageLocation.boxId'];\n      let results;\n      if (coldChainIncidentId) {\n        results = samples.filter((sample) => sample.coldChainIncidentId === String(coldChainIncidentId) && (!specimenStatus || sample.specimenStatus === specimenStatus));\n      } else if (boxIdFilter) {\n        results = samples.filter((sample) => boxIdFilter.$in.includes(sample.storageLocation?.boxId) && sample.status !== 'QUARANTINED');\n      } else {"
new = "      const specimenIdFilter = filter?.$and?.find((clause) => clause?.specimenId)?.specimenId;\n      let results;\n      if (coldChainIncidentId) {\n        results = samples.filter((sample) => sample.coldChainIncidentId === String(coldChainIncidentId) && (!specimenStatus || sample.specimenStatus === specimenStatus));\n      } else if (specimenIdFilter) {\n        results = samples.filter((sample) => specimenIdFilter.$in.includes(sample.specimenId) && sample.specimenStatus !== 'quarantined');\n      } else {"
text = text.replace(old, new)
handler_anchor = "      if (name === 'storageBoxes') return storageBoxesCollection;\n"
handler_new = handler_anchor + "      if (name === 'storagePositions') return storagePositionsCollection;\n      if (name === 'containerPositionAssignments') return containerPositionAssignmentsCollection;\n      if (name === 'specimenContainerAssignments') return specimenContainerAssignmentsCollection;\n      if (name === 'containers' || name === 'storageRacks' || name === 'rackLocationAssignments') return emptyCanonicalCollection();\n"
if "name === 'storagePositions'" not in text:
    text = text.replace(handler_anchor, handler_new, 1)
write(p, text)

# Notification unit suite: isolate Compose-provided SMTP/Mongo/Redis.
p = "api/backend/tests/unit/NotificationService.test.js"
text = read(p)
if "let originalSmtpTransport;" not in text:
    text = text.replace(
        "  let originalEmailFrom;\n",
        "  let originalEmailFrom;\n  let originalSmtpTransport;\n  let originalNotificationQueue;\n",
    )
old = "    originalResendClient = notificationService.resendClient;\n    originalEmailFrom = notificationService.emailFrom;\n"
new = old + "    originalSmtpTransport = notificationService.smtpTransport;\n    originalNotificationQueue = notificationService.notificationQueue;\n    delete process.env.SMTP_HOST;\n    delete process.env.SMTP_PORT;\n    delete process.env.MONGO_URI;\n    delete process.env.REDIS_HOST;\n    delete process.env.REDIS_PORT;\n    delete process.env.REDIS_PASSWORD;\n    delete process.env.REDIS_URL;\n    notificationService.smtpTransport = null;\n    notificationService.notificationQueue = null;\n"
if new not in text:
    if old not in text:
        raise SystemExit("Notification beforeEach anchor missing")
    text = text.replace(old, new, 1)
old = "    notificationService.emailFrom = originalEmailFrom;\n    notificationService.io = null;\n"
new = "    notificationService.emailFrom = originalEmailFrom;\n    notificationService.smtpTransport = originalSmtpTransport;\n    notificationService.notificationQueue = originalNotificationQueue;\n    notificationService.io = null;\n"
text = text.replace(old, new, 1)
write(p, text)

# Staging import: isolate index helper except in its wiring assertion.
p = "api/backend/tests/unit/staging-import.service.test.js"
text = read(p)
old = "    vi.spyOn(logger, 'error').mockImplementation(() => {});\n    stagingImportService = reloadService();"
new = "    vi.spyOn(logger, 'error').mockImplementation(() => {});\n    vi.spyOn(stagingImportIndexes, 'ensureStagingImportIndexes').mockResolvedValue(undefined);\n    stagingImportService = reloadService();"
text = text.replace(old, new, 1)
old = "      const ensureSpy = vi\n        .spyOn(stagingImportIndexes, 'ensureStagingImportIndexes')\n        .mockResolvedValue(undefined);\n      stagingImportService = reloadService();"
new = "      const ensureSpy = stagingImportIndexes.ensureStagingImportIndexes;\n      ensureSpy.mockClear();\n      ensureSpy.mockResolvedValue(undefined);\n      stagingImportService = reloadService();"
text = text.replace(old, new, 1)
write(p, text)

# Port-manager: remove redundant OS-tool-dependent tests; deterministic exec/process.kill coverage remains.
p = "api/backend/tests/unit/portManager.test.js"
text = read(p)
patterns = [
    r"\n    it\('returns the pid \(and usually process name\) of the real process bound to the port'.*?\n    \}, 15000\);",
    r"\n    it\('kills the real process bound to the port and frees it'.*?\n    \}, 15000\);",
    r"\n    it\('frees and reuses the requested port when the process on it can be killed'.*?\n    \}, 15000\);",
]
for pat in patterns:
    text, n = re.subn(pat, "", text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"portManager obsolete OS-dependent test not found: {pat}")
write(p, text)

# Sample label fixtures / responses use canonical specimenId.
p = "api/backend/src/interface/routes/sample.routes.js"
text = read(p)
text = text.replace(
    "  const sampleId = String(sample._id);\n\n  const priorGeneration = await labelGenerationsCollection.findOne({ specimenId: sampleId });",
    "  const specimenId = String(sample.specimenId || sample._id);\n\n  const priorGeneration = await labelGenerationsCollection.findOne({ specimenId });",
)
text = text.replace("    specimenId: sampleId,", "    specimenId,", 1)
text = text.replace("${sampleId} (${formats.join(', ')})", "${specimenId} (${formats.join(', ')})")
text = text.replace("payload: { specimenId: sampleId,", "payload: { specimenId,")
text = text.replace(
    "function buildZplPrintJob({ sampleId, barcode, location }) {\n  const safeSampleId = escapeZpl(sampleId);",
    "function buildZplPrintJob({ specimenId, barcode, location }) {\n  const safeSpecimenId = escapeZpl(specimenId);",
)
text = text.replace("${safeSampleId}^FS", "${safeSpecimenId}^FS")
text = text.replace(
    "buildZplPrintJob({ sampleId: sampleIdentifier, barcode: sample.barcode, location })",
    "buildZplPrintJob({ specimenId: sampleIdentifier, barcode: sample.barcode, location })",
)
text = text.replace("        sampleId: sampleIdentifier,", "        specimenId: sampleIdentifier,")
write(p, text)

p = "api/backend/tests/unit/sample.routes.test.js"
text = read(p)
text = text.replace("{ _id: 's1', sampleID: 's1', barcode: 'BC-1' }", "{ _id: 's1', specimenId: 's1', barcode: 'BC-1' }")
text = text.replace("{ _id: 's2', sampleID: 's2', barcode: 'BC-2' }", "{ _id: 's2', specimenId: 's2', barcode: 'BC-2' }")
text = text.replace("{ _id: 's1', sampleID: 's1', barcode: 'BC-1', collectionSite: 'org-9' }", "{ _id: 's1', specimenId: 's1', barcode: 'BC-1', collectionSite: 'org-9' }")
text = text.replace("sampleID: 42,\n        barcode: 'BC1',", "specimenId: 'SPEC-42',\n        barcode: 'BC1',")
text = text.replace("          sampleId: '42',", "          specimenId: 'SPEC-42',")
old = "      expect(createSample).toHaveBeenCalledWith(\n        expect.anything(),\n        { participantId: VALID_PAYLOAD.participantId },\n        // #474: the route's sampleRepository.create wrapper now also\n        // forwards neo4jDriver so createSample can pass it through to\n        // AllocateSampleUseCase's lineage repository.\n        { neo4jDriver: null }\n      );"
new = "      expect(createSample).toHaveBeenCalledWith(\n        expect.anything(),\n        { participantId: VALID_PAYLOAD.participantId },\n        {}\n      );"
text = text.replace(old, new)
write(p, text)

# Telemetry tests: current v2 Mongo authority + normalized physical chain + outbox.
p = "api/backend/tests/unit/infrastructure/services/TelemetryMonitor.test.js"
text = read(p)
run_cycle = """  describe('runCycle()', () => {
    it('logs a warning and returns early when db is unavailable', async () => {
      const monitor = new TelemetryMonitor({ db: null });
      await expect(monitor.runCycle()).resolves.toEqual({ processed: 0 });
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Banco Mongo indisponível'));
    });

    it('does not propagate when no critical freezer is found', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockResolvedValue([]);
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([]);
      monitor.propagateCompromise = vi.fn();
      await expect(monitor.runCycle()).resolves.toEqual({ processed: 0, criticalFreezers: 0 });
      expect(monitor.propagateCompromise).not.toHaveBeenCalled();
    });

    it('propagates each canonical root specimen from a critical freezer', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      monitor.checkMissingReadings = vi.fn().mockResolvedValue([]);
      monitor.findCriticalFreezers = vi.fn().mockResolvedValue([{ freezerKey: 'sensor-A', rootSampleIds: ['SPEC-1', 'SPEC-2'], breachedSince: new Date('2026-01-01T00:00:00Z'), maxObservedTemp: -50 }]);
      monitor.propagateCompromise = vi.fn().mockResolvedValue({ summarized: 1 });
      const result = await monitor.runCycle();
      expect(result).toEqual({ processed: 2, criticalFreezers: 1 });
      expect(monitor.propagateCompromise).toHaveBeenCalledTimes(2);
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(1, expect.objectContaining({ freezerKey: 'sensor-A', rootSampleId: 'SPEC-1' }));
      expect(monitor.propagateCompromise).toHaveBeenNthCalledWith(2, expect.objectContaining({ freezerKey: 'sensor-A', rootSampleId: 'SPEC-2' }));
    });
  });

"""
text, n = re.subn(
    r"  describe\('runCycle\(\)', \(\) => \{.*?\n  \}\);\n\n(?=  describe\('shouldTrigger\(\)')",
    run_cycle,
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("Telemetry runCycle block not replaced")
old = "      expect(result).toEqual([\n        {\n          freezerKey: 'sensor-A',\n          rootSampleId: 'sample-1',\n          breachedSince: new Date('2026-01-01T03:00:00Z'),\n          maxObservedTemp: -60\n        }\n      ]);"
new = "      expect(result).toHaveLength(1);\n      expect(result[0]).toEqual(expect.objectContaining({\n        freezerKey: 'sensor-A',\n        rootSampleId: 'sample-1',\n        rootSampleIds: ['sample-1'],\n        breachedSince: new Date('2026-01-01T03:00:00Z'),\n        maxObservedTemp: -60,\n        observationCount: 3,\n        sourceQueryHash: expect.stringMatching(/^sha256:/),\n        sourceReadingSetHash: expect.stringMatching(/^sha256:/)\n      }));"
text = text.replace(old, new)
resolve_block = """  describe('resolveRootSamples()', () => {
    function cursor(rows) { return { toArray: vi.fn().mockResolvedValue(rows) }; }
    function buildDb({ sensor = null, rackAssignments = [], positions = [], positionAssignments = [], specimenAssignments = [] } = {}) {
      const collections = {
        sensorMetadata: { findOne: vi.fn().mockResolvedValue(sensor) },
        rackLocationAssignments: { find: vi.fn(() => cursor(rackAssignments)) },
        storagePositions: { find: vi.fn(() => cursor(positions)) },
        containerPositionAssignments: { find: vi.fn(() => cursor(positionAssignments)) },
        specimenContainerAssignments: { find: vi.fn(() => cursor(specimenAssignments)) },
      };
      return { collections, collection: vi.fn((name) => {
        if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
        return collections[name];
      }) };
    }

    it('returns [] when sensor metadata is absent', async () => {
      const db = buildDb();
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-unknown')).resolves.toEqual([]);
    });

    it('returns [] when sensor metadata has no storageContainer link', async () => {
      const db = buildDb({ sensor: { sensorId: 'sensor-A', storageContainer: null } });
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-A')).resolves.toEqual([]);
    });

    it('walks RackLocationAssignment -> StoragePosition -> ContainerPositionAssignment -> SpecimenContainerAssignment', async () => {
      const db = buildDb({
        sensor: { sensorId: 'sensor-A', storageContainer: 'LOC-1' },
        rackAssignments: [{ storageRackId: 'RACK-1', storageLocationId: 'LOC-1', removedAt: null }],
        positions: [{ storagePositionId: 'RACK-1:A1', storageRackId: 'RACK-1' }],
        positionAssignments: [{ containerId: 'CONT-1', storagePositionId: 'RACK-1:A1', removedAt: null }],
        specimenAssignments: [
          { specimenId: 'SPEC-1', containerId: 'CONT-1', releasedAt: null },
          { specimenId: 'SPEC-1', containerId: 'CONT-1', releasedAt: null },
        ],
      });
      const monitor = new TelemetryMonitor({ db });
      await expect(monitor.resolveRootSamples('sensor-A')).resolves.toEqual(['SPEC-1']);
      expect(db.collection).toHaveBeenCalledWith('rackLocationAssignments');
      expect(db.collection).toHaveBeenCalledWith('specimenContainerAssignments');
    });
  });

"""
text, n = re.subn(
    r"  describe\('resolveRootSamples\(\)', \(\) => \{.*?\n  \}\);\n\n(?=  describe\('propagateCompromise\(\)')",
    resolve_block,
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("Telemetry resolveRootSamples block not replaced")
propagate_block = """  describe('propagateCompromise()', () => {
    function transactionalDb(telemetryCollection) {
      const session = {
        withTransaction: vi.fn(async (handler) => handler()),
        endSession: vi.fn().mockResolvedValue(undefined),
      };
      const client = {
        db: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0', isWritablePrimary: true }) })),
        startSession: vi.fn(() => session),
      };
      return {
        client,
        session,
        collection: vi.fn((name) => {
          if (name === 'telemetryExposureSummaries') return telemetryCollection;
          throw new Error(`unexpected collection ${name}`);
        }),
      };
    }

    it('returns summarized=0 when no root specimen was resolved', async () => {
      const monitor = new TelemetryMonitor({ db: {} });
      await expect(monitor.propagateCompromise({ rootSampleId: null, freezerKey: 'sensor-A' })).resolves.toEqual({ summarized: 0 });
    });

    it('persists the exposure summary and enqueues the graph projection in one Mongo transaction', async () => {
      const telemetryCollection = { updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }) };
      const db = transactionalDb(telemetryCollection);
      const root = { _id: 'mongo-1', specimenId: 'SPEC-1', parentSpecimenIds: [] };
      const samples = {
        findOne: vi.fn().mockResolvedValue(root),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
      };
      getCollectionSpy.mockResolvedValue(samples);
      const physicalStore = { findCurrentBySpecimen: vi.fn().mockResolvedValue({ specimenContainerAssignmentId: 'SCA-1', containerPositionAssignmentId: 'CPA-1', rackLocationAssignmentId: 'RLA-1' }) };
      const graphProjectionService = { appendTelemetryExposureSummaryEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
      const monitor = new TelemetryMonitor({ db, physicalStore, graphProjectionService });

      const result = await monitor.propagateCompromise({
        rootSampleId: 'SPEC-1', freezerKey: 'sensor-A',
        breachedSince: new Date('2026-01-01T00:00:00Z'), windowEnd: new Date('2026-01-01T01:00:00Z'),
        minimumValue: -70, maxObservedTemp: -60, meanValue: -65,
        observationCount: 5, timeOutsideThresholdSeconds: 3600, coverageRatio: 1,
        sourceQueryHash: 'sha256:q', sourceReadingSetHash: 'sha256:r'
      });

      expect(result).toEqual({ summarized: 1 });
      expect(db.client.startSession).toHaveBeenCalledTimes(1);
      expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(telemetryCollection.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ $setOnInsert: expect.objectContaining({ specimenId: 'SPEC-1' }) }),
        expect.objectContaining({ upsert: true, session: db.session })
      );
      expect(graphProjectionService.appendTelemetryExposureSummaryEvent).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ specimenId: 'SPEC-1', sourceService: 'telemetry-monitor-v2' }),
        { session: db.session }
      );
    });
  });
"""
text, n = re.subn(
    r"  describe\('propagateCompromise\(\)', \(\) => \{.*?\n  \}\);\n\}\);\s*$",
    propagate_block + "\n});\n",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit("Telemetry propagate block not replaced")
write(p, text)

print("Batch 3 canonical reconciliation script completed.")
