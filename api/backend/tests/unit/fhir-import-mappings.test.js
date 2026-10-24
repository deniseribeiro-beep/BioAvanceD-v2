// RF011 AC4, RF011 AC6, MAP-V2-006..009 (#1322): the import of Provenance,
// AuditEvent, DocumentReference and ResearchStudy is the inverse of their
// export, forces no equivalence and reports field names and paths only.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  toFhirProvenance,
  toFhirAuditEvent,
  toFhirDocumentReference,
  toFhirResearchStudy,
} = require('../../src/services/fhir.service');
const {
  MAX_MAPPED_RESOURCES,
  IMPORT_ROUND_TRIP_LIMITATIONS,
  fromFhirProvenance,
  fromFhirAuditEvent,
  fromFhirDocumentReference,
  fromFhirResearchStudy,
  stageMappedResources,
} = require('../../src/resources/fhir/import-mappings');
const { buildBundleRoundTripLoss } = require('../../src/resources/fhir/round-trip-loss');

const workflowRun = {
  workflowRunId: 'WR-1',
  workflowId: 'WF-1',
  outputFileIds: ['F-OUT-1', 'F-OUT-2'],
  inputFileIds: ['F-IN-1'],
  startedAt: '2026-10-01T10:00:00.000Z',
  completedAt: '2026-10-01T11:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  createdBy: 'U-EXEC',
  hardwareProfile: 'gpu',
};

const auditEvent = {
  eventId: 'EV-1',
  action: 'UPDATE',
  occurredAt: '2026-10-02T10:00:00.000Z',
  recordedAt: '2026-10-02T10:00:01.000Z',
  result: 'success',
  purpose: 'auditoria',
  actorPseudonym: 'PSEUDO-1',
  source: 'api',
  entityId: 'S-1',
  entityType: 'Sample',
  eventHash: 'abc',
};

const dataFile = {
  fileId: 'F-1',
  fileRole: 'raw',
  storageUri: 's3://bucket/f-1',
  mimeType: 'text/csv',
  fileSize: 1234,
  specimenId: 'S-1',
  linkedEntityRefs: [{ entityId: 'WR-1', entityType: 'WorkflowRun' }, { entityId: 'X-1' }],
  checksum: 'ff',
};

const study = {
  studyId: 'ST-1',
  studyTitle: 'Estudo de coorte',
  protocolId: 'PR-1',
  studyStatus: 'active',
  studyObjective: 'Objetivo',
  recruitmentPeriod: { start: '2026-01-01', end: '2026-12-31' },
  principalInvestigator: 'PI-1',
  ethicsApprovalId: ['CEP-1', 'CEP-2'],
  studyAcronym: 'EC',
};

function report(resource) {
  return stageMappedResources([resource]).report.mappedResources[0];
}

describe('import mappings round trip (RF011 AC4, #1322)', () => {
  it('Provenance gives back the WorkflowRun fields the export carries', () => {
    const resource = toFhirProvenance(workflowRun);
    expect(fromFhirProvenance(resource).candidate).toEqual({
      workflowRunId: 'WR-1',
      outputFileIds: ['F-OUT-1', 'F-OUT-2'],
      inputFileIds: ['F-IN-1'],
      startedAt: '2026-10-01T10:00:00.000Z',
      completedAt: '2026-10-01T11:00:00.000Z',
      createdAt: '2026-10-01T09:00:00.000Z',
      createdBy: 'U-EXEC',
    });
    expect(report(resource)).toMatchObject({ mappingId: 'MAP-V2-008', canonicalEntity: 'WorkflowRun', unmappedCount: 0, unmapped: [] });
  });

  it('AuditEvent gives back the audit event fields the export carries', () => {
    const resource = toFhirAuditEvent(auditEvent);
    const { eventHash, ...carried } = auditEvent;
    expect(fromFhirAuditEvent(resource).candidate).toEqual(carried);
    expect(report(resource)).toMatchObject({ mappingId: 'MAP-V2-006', canonicalEntity: 'AuditEvent', unmappedCount: 0 });

    const failed = toFhirAuditEvent({ ...auditEvent, result: 'failure' });
    expect(fromFhirAuditEvent(failed).candidate.result).toBe('failure');
    expect(report(failed).unmappedCount).toBe(0);
  });

  it('DocumentReference gives back the DataFile fields the export carries', () => {
    const resource = toFhirDocumentReference(dataFile);
    const { checksum, ...carried } = dataFile;
    expect(fromFhirDocumentReference(resource).candidate).toEqual(carried);
    expect(report(resource)).toMatchObject({ mappingId: 'MAP-V2-007', canonicalEntity: 'DataFile', unmappedCount: 0 });
  });

  it('ResearchStudy gives back the Study fields the export carries', () => {
    const resource = toFhirResearchStudy(study);
    const { studyAcronym, ...carried } = study;
    expect(fromFhirResearchStudy(resource).candidate).toEqual(carried);
    expect(report(resource)).toMatchObject({ mappingId: 'MAP-V2-009', canonicalEntity: 'Study', unmappedCount: 0 });
  });

  it('a ResearchStudy with no id takes its studyId from the first identifier', () => {
    const resource = { resourceType: 'ResearchStudy', identifier: [{ system: 'x' }, { value: 'ST-2' }] };
    const { candidate, mappedPaths } = fromFhirResearchStudy(resource);
    expect(candidate).toEqual({ studyId: 'ST-2' });
    expect(mappedPaths).toEqual(['ResearchStudy.identifier[1].value']);
  });

  it('reports canonicalFields sorted and the limitations of the type', () => {
    const entry = report(toFhirResearchStudy(study));
    expect(entry.canonicalFields).toEqual([...entry.canonicalFields].sort());
    expect(entry.limitations).toBe(IMPORT_ROUND_TRIP_LIMITATIONS.ResearchStudy);
    expect(Object.isFrozen(IMPORT_ROUND_TRIP_LIMITATIONS.ResearchStudy)).toBe(true);
  });
});

describe('import mappings force no equivalence (RF011 AC6, #1322)', () => {
  it('an AuditEvent outcome 8 gives no result and stays unmapped', () => {
    const resource = { resourceType: 'AuditEvent', id: 'EV-8', outcome: '8' };
    expect(fromFhirAuditEvent(resource).candidate).toEqual({ eventId: 'EV-8' });
    expect(report(resource).unmapped).toEqual(['AuditEvent.outcome']);
  });

  it('an AuditEvent outcomeDesc outside the closed list gives no result', () => {
    const resource = { resourceType: 'AuditEvent', outcomeDesc: 'erro' };
    expect(fromFhirAuditEvent(resource).candidate).toEqual({});
    expect(report(resource).unmapped).toEqual(['AuditEvent.outcomeDesc']);
  });

  it('a Provenance target that is not a DocumentReference gives no outputFileIds', () => {
    const resource = { resourceType: 'Provenance', target: [{ reference: 'Patient/P1' }] };
    expect(fromFhirProvenance(resource).candidate).toEqual({});
    expect(report(resource).unmapped).toEqual(['Provenance.target[0].reference']);
  });

  it('a DocumentReference status superseded is unmapped', () => {
    const resource = { resourceType: 'DocumentReference', id: 'F-2', status: 'superseded' };
    expect(fromFhirDocumentReference(resource).candidate).toEqual({ fileId: 'F-2' });
    expect(report(resource).unmapped).toEqual(['DocumentReference.status']);
  });

  it('a ResearchStudy status draft gives no studyStatus', () => {
    const resource = { resourceType: 'ResearchStudy', status: 'draft' };
    expect(fromFhirResearchStudy(resource).candidate).toEqual({});
    expect(report(resource).unmapped).toEqual(['ResearchStudy.status']);
  });
});

describe('import mappings on malformed input (#1322)', () => {
  it('does not throw on malformed elements', () => {
    expect(fromFhirProvenance({ resourceType: 'Provenance', target: 'x', agent: [null], entity: [5] }).candidate).toEqual({});
    expect(fromFhirAuditEvent({ resourceType: 'AuditEvent', agent: [null], entity: 'x', purposeOfEvent: {} }).candidate).toEqual({});
    expect(fromFhirDocumentReference({ resourceType: 'DocumentReference', context: { related: 5 }, content: [{}] }).candidate).toEqual({});
    expect(fromFhirResearchStudy({ resourceType: 'ResearchStudy', id: 7, identifier: [null], relatedArtifact: 'x' }).candidate).toEqual({});
  });

  it('throws on null, an array or another resource type', () => {
    expect(() => fromFhirProvenance(null)).toThrow();
    expect(() => fromFhirProvenance([])).toThrow();
    expect(() => fromFhirProvenance({ resourceType: 'Patient', id: 'P1' })).toThrow();
  });
});

describe('stageMappedResources (RF011 AC4, #1322)', () => {
  it('skips other types and an inherited resourceType key', () => {
    const resources = [{ resourceType: 'Organization' }, { resourceType: 'toString' }, null, 'texto', { resourceType: 'Provenance', id: 'WR-9' }];
    const { report: batch, mapped } = stageMappedResources(resources);
    expect(batch.mappedResourceCount).toBe(1);
    expect(batch.mappedResources[0]).toMatchObject({ resourceIndex: 4, resourceType: 'Provenance', canonicalFields: ['workflowRunId'] });
    expect(mapped.has(resources[4])).toBe(true);
    expect(mapped.size).toBe(1);
  });

  it('keeps the first 50 of 60 AuditEvents and none of the 60 is unattached', () => {
    const resources = Array.from({ length: 60 }, (_, i) => ({ resourceType: 'AuditEvent', id: `EV-${i}` }));
    const { report: batch, mapped } = stageMappedResources(resources);
    expect(MAX_MAPPED_RESOURCES).toBe(50);
    expect(batch.mappedResourceCount).toBe(60);
    expect(batch.mappedResources).toHaveLength(50);
    expect(batch.truncated).toBe(true);
    expect(mapped.size).toBe(60);
    expect(buildBundleRoundTripLoss(resources, [], mapped)).toEqual({ unattachedResourceCount: 0, unattached: [] });
  });
});
