const { test } = require('node:test');
const assert = require('node:assert/strict');

const canonicalV2 = require('../../src/contracts/canonical/v2');
const PhysicalStorageV2 = require('../../src/models/PhysicalStorageV2');
const ConsentGovernanceV2Repository = require('../../src/infrastructure/persistence/mongo/ConsentGovernanceV2Repository');
const { Neo4jOutboxService } = require('../../src/services/neo4jOutbox.service');
const TelemetryMonitor = require('../../src/infrastructure/services/TelemetryMonitor');

/**
 * #967 — canonical contract <-> runtime producer conformance.
 *
 * canonical-catalog-conformance.arch.test.js proves the approved dictionary
 * is faithfully represented by the 146 executable v2 contracts. That is a
 * dictionary->contract proof. This file supplies the missing second edge:
 * contract->runtime for authoritative producers that can be executed without
 * infrastructure I/O.
 *
 * A target belongs here when its object is the document/event shape actually
 * persisted or appended at runtime. Intermediate compatibility views and
 * pre-encryption/plaintext DTOs do NOT belong here; registering those would
 * compare the contract against a transformation input instead of the stored
 * representation.
 *
 * The gate is deliberately zero-waiver: a registered producer may not emit a
 * field absent from its canonical entity contract, and every contract field
 * marked required must be present in the produced object. Optional canonical
 * fields do not have to be synthesized merely to satisfy this test.
 */

function keysOf(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'runtime producer must return an object');
  return new Set(Object.keys(value));
}

async function diffRuntimeShape(entity, runtimeObject) {
  const schema = await canonicalV2.getSchema(entity);
  assert.ok(schema, `canonical v2 schema not found for ${entity}`);

  const runtimeKeys = keysOf(runtimeObject);
  const canonicalKeys = new Set(Object.keys(schema.properties || {}));
  const requiredKeys = new Set(schema.required || []);

  return {
    extra: [...runtimeKeys].filter((key) => !canonicalKeys.has(key)).sort(),
    missingRequired: [...requiredKeys].filter((key) => !runtimeKeys.has(key)).sort(),
    schema,
  };
}

const fixedNow = new Date('2026-09-14T12:00:00.000Z');

function buildConsentPermission() {
  const repo = new ConsentGovernanceV2Repository(
    { collection: () => ({}) },
    { graphProjectionService: {} },
  );
  return repo.buildPermissionDocuments({
    consentId: 'consent-runtime-1',
    template: {
      version: '2.0.0',
      permissions: [{
        permissionCode: 'research_use',
        purpose: { code: 'research' },
        required: true,
      }],
    },
    responses: { research_use: true },
    createdAt: fixedNow,
  })[0];
}

const RUNTIME_TARGETS = Object.freeze({
  Container: () => PhysicalStorageV2.container({
    containerId: 'container-runtime-1',
    containerType: 'specimen_primary_container',
    status: 'occupied',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  }),
  StorageRack: () => PhysicalStorageV2.storageRack({
    storageRackId: 'rack-runtime-1',
    rackType: 'specimen_storage_rack',
    rowCount: 9,
    columnCount: 9,
    capacity: 81,
    sourceStorageBoxId: 'box-runtime-1',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  }),
  StoragePosition: () => PhysicalStorageV2.storagePosition({
    storagePositionId: 'rack-runtime-1:A1',
    storageRackId: 'rack-runtime-1',
    positionCode: 'A1',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  }),
  SpecimenContainerAssignment: () => PhysicalStorageV2.specimenContainerAssignment({
    specimenContainerAssignmentId: 'sca-runtime-1',
    specimenId: 'specimen-runtime-1',
    containerId: 'container-runtime-1',
    assignedAt: fixedNow,
  }),
  ContainerPositionAssignment: () => PhysicalStorageV2.containerPositionAssignment({
    containerPositionAssignmentId: 'cpa-runtime-1',
    containerId: 'container-runtime-1',
    storagePositionId: 'rack-runtime-1:A1',
    placedAt: fixedNow,
  }),
  RackLocationAssignment: () => PhysicalStorageV2.rackLocationAssignment({
    rackLocationAssignmentId: 'rla-runtime-1',
    storageRackId: 'rack-runtime-1',
    storageLocationId: 'location-runtime-1',
    placedAt: fixedNow,
  }),
  ConsentPermission: () => buildConsentPermission(),
  GraphProjectionOutboxEvent: () => new Neo4jOutboxService().buildEvent({
    eventId: 'event-runtime-1',
    eventType: 'SPECIMEN_UPSERTED',
    aggregateType: 'Specimen',
    aggregateId: 'specimen-runtime-1',
    payload: { specimenId: 'specimen-runtime-1' },
    sourceService: 'canonical-runtime-conformance',
    traceId: 'trace-runtime-1',
    schemaVersion: 2,
    occurredAt: fixedNow,
  }),
  TelemetryExposureSummary: () => new TelemetryMonitor({
    graphProjectionService: {},
    physicalStore: {},
  }).buildExposureSummary({
    specimen: { specimenId: 'specimen-runtime-1' },
    assignment: {
      specimenContainerAssignmentId: 'sca-runtime-1',
      containerPositionAssignmentId: 'cpa-runtime-1',
      rackLocationAssignmentId: 'rla-runtime-1',
    },
    freezerKey: 'sensor-runtime-1',
    breachedSince: fixedNow,
    windowEnd: new Date('2026-09-14T13:00:00.000Z'),
    minimumValue: -79,
    maxObservedTemp: -70,
    meanValue: -75,
    observationCount: 5,
    timeOutsideThresholdSeconds: 3600,
    coverageRatio: 1,
    sourceQueryHash: 'sha256:query',
    sourceReadingSetHash: 'sha256:readings',
  }),
});

test('runtime conformance registry covers the authoritative v2 producers selected for #967', () => {
  assert.deepEqual(Object.keys(RUNTIME_TARGETS).sort(), [
    'ConsentPermission',
    'Container',
    'ContainerPositionAssignment',
    'GraphProjectionOutboxEvent',
    'RackLocationAssignment',
    'SpecimenContainerAssignment',
    'StoragePosition',
    'StorageRack',
    'TelemetryExposureSummary',
  ].sort());
});

for (const [entity, producer] of Object.entries(RUNTIME_TARGETS)) {
  test(`${entity} runtime producer conforms to canonical v2 field names and required fields`, async () => {
    const runtimeObject = producer();
    const diff = await diffRuntimeShape(entity, runtimeObject);
    const observed = { extra: diff.extra, missingRequired: diff.missingRequired };
    assert.deepEqual(
      observed,
      { extra: [], missingRequired: [] },
      `${entity} runtime drift detected: ${JSON.stringify(observed)}; canonicalSchema=${JSON.stringify(diff.schema)}`,
    );
  });
}

test('the conformance helper fails in both directions: invented runtime key and absent required canonical key', async () => {
  const valid = PhysicalStorageV2.container({
    containerId: 'container-runtime-probe',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  const schema = await canonicalV2.getSchema('Container');
  const required = [...(schema.required || [])];
  assert.ok(required.length > 0, 'Container must have at least one required canonical field for the negative probe');

  const invented = { ...valid, definitelyNotCanonical: true };
  const extraDiff = await diffRuntimeShape('Container', invented);
  assert.ok(extraDiff.extra.includes('definitelyNotCanonical'));

  const missing = { ...valid };
  delete missing[required[0]];
  const missingDiff = await diffRuntimeShape('Container', missing);
  assert.ok(missingDiff.missingRequired.includes(required[0]));
});
