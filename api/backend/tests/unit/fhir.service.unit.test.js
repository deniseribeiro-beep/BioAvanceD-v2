import { describe, it, expect } from 'vitest';
const fhirService = require('../../src/services/fhir.service');

describe('FHIRService.validateFHIRResource', () => {
  it('returns true for valid resource', () => {
    expect(fhirService.validateFHIRResource({ resourceType: 'Patient', id: '123' })).toBe(true);
  });

  it('throws when resourceType is missing', () => {
    expect(() => fhirService.validateFHIRResource({ id: '123' })).toThrow('Recurso FHIR inválido');
  });

  it('throws when id is missing', () => {
    expect(() => fhirService.validateFHIRResource({ resourceType: 'Patient' })).toThrow('Recurso FHIR inválido');
  });
});

describe('FHIRService.toFhirPatient', () => {
  it('builds a FHIR Patient resource from a participant plus its resolved identity', () => {
    const participant = {
      participantId: 'P100',
      sex: 'female',
    };
    const identity = {
      patientName: 'Maria Silva Santos',
      birthDate: '1990-05-20',
    };

    const result = fhirService.toFhirPatient(participant, identity);

    expect(result.resourceType).toBe('Patient');
    expect(result.id).toBe('P100');
    expect(result.identifier).toEqual([{ value: 'P100' }]);
    expect(result.name).toEqual([{ use: 'official', text: 'Maria Silva Santos' }]);
    expect(result.birthDate).toBe('1990-05-20');
    expect(result.gender).toBe('female');
  });

  it('falls back to empty identifier/name and unknown gender when fields and identity are absent', () => {
    const result = fhirService.toFhirPatient({});

    expect(result.id).toBeUndefined();
    expect(result.identifier).toEqual([]);
    expect(result.name).toEqual([]);
    expect(result.birthDate).toBeUndefined();
    expect(result.gender).toBe('unknown');
  });

  it('falls back to empty name/birthDate when a participant is given but no identity is resolved', () => {
    const result = fhirService.toFhirPatient({ participantId: 'P100', sex: 'male' });

    expect(result.name).toEqual([]);
    expect(result.birthDate).toBeUndefined();
    expect(result.gender).toBe('male');
  });

  it('throws when given a non-object participant', () => {
    expect(() => fhirService.toFhirPatient(null)).toThrow();
  });
});

describe('FHIRService.toFhirSpecimen', () => {
  it('builds a FHIR Specimen resource from a specimen', () => {
    const specimen = {
      specimenId: 'S1',
      participantId: 'P100',
      registeredAt: '2026-01-01T00:00:00Z',
      specimenStatus: 'available',
    };

    const result = fhirService.toFhirSpecimen(specimen);

    expect(result.resourceType).toBe('Specimen');
    expect(result.id).toBe('S1');
    expect(result.identifier).toEqual([{ value: 'S1' }]);
    expect(result.subject).toEqual({ reference: 'Patient/P100' });
    expect(result.receivedTime).toBe('2026-01-01T00:00:00Z');
    expect(result.status).toBe('available');
  });

  it('falls back to empty identifier, no subject, and available status when fields are absent', () => {
    const result = fhirService.toFhirSpecimen({});

    expect(result.identifier).toEqual([]);
    expect(result.subject).toBeUndefined();
    expect(result.receivedTime).toBeUndefined();
    expect(result.status).toBe('available');
  });

  it('throws when given a non-object specimen', () => {
    expect(() => fhirService.toFhirSpecimen(null)).toThrow();
  });

  it('uses specimenStatus when present', () => {
    const specimen = {
      specimenId: 'S1',
      specimenStatus: 'quarantined',
    };

    const result = fhirService.toFhirSpecimen(specimen);

    expect(result.status).toBe('quarantined');
  });
});

describe('FHIRService.toFhirConsent', () => {
  it('builds an active Consent resource when consent is granted', () => {
    const result = fhirService.toFhirConsent({ consentTemplateId: 'CT-1', consentGranted: true });

    expect(result.resourceType).toBe('Consent');
    expect(result.id).toBe('CT-1');
    expect(result.status).toBe('active');
  });

  it('builds an inactive Consent resource when consent is not granted', () => {
    const result = fhirService.toFhirConsent({ consentTemplateId: 'CT-2', consentGranted: false });

    expect(result.status).toBe('inactive');
  });

  it('throws when given a non-object consent', () => {
    expect(() => fhirService.toFhirConsent(null)).toThrow();
  });
});

describe('FHIRService.resultToFHIR', () => {
  it('builds Observation and DiagnosticReport resources keyed off resultID', () => {
    const { observation, diagnosticReport } = fhirService.resultToFHIR({ resultID: 'R1' });

    expect(observation.resourceType).toBe('Observation');
    expect(observation.id).toBe('R1');
    expect(diagnosticReport.resourceType).toBe('DiagnosticReport');
    expect(diagnosticReport.id).toBe('dr-R1');
  });

  it('falls back to _id then the literal "result" when resultID is absent', () => {
    const { observation, diagnosticReport } = fhirService.resultToFHIR({ _id: 'abc' });
    expect(observation.id).toBe('abc');
    expect(diagnosticReport.id).toBe('dr-abc');

    const fallback = fhirService.resultToFHIR({});
    expect(fallback.observation.id).toBe('result');
    expect(fallback.diagnosticReport.id).toBe('dr-result');
  });

  it('throws when given a non-object result', () => {
    expect(() => fhirService.resultToFHIR(null)).toThrow();
  });
});

describe('FHIRService.temperatureToFHIR', () => {
  it('builds Device and Observation resources keyed off sensorId', () => {
    const { device, observation } = fhirService.temperatureToFHIR({
      sensorId: 'SENSOR-1',
      _id: 'T1',
    });

    expect(device.resourceType).toBe('Device');
    expect(device.id).toBe('device-SENSOR-1');
    expect(observation.resourceType).toBe('Observation');
    expect(observation.id).toBe('temp-T1');
  });

  it('falls back to unknown sensor and timestamp/reading defaults when fields are absent', () => {
    const { device, observation } = fhirService.temperatureToFHIR({ timestamp: 'ts-1' });
    expect(device.id).toBe('device-unknown');
    expect(observation.id).toBe('temp-ts-1');

    const fallback = fhirService.temperatureToFHIR({});
    expect(fallback.observation.id).toBe('temp-reading');
  });

  it('throws when given a non-object temperature', () => {
    expect(() => fhirService.temperatureToFHIR(null)).toThrow();
  });
});

describe('FHIRService.toFhirProvenance', () => {
  const run = {
    workflowRunId: 'WR-1',
    workflowId: 'WF-1',
    workflowVersion: '1.0.0',
    createdBy: 'User/u-1',
    containerImageDigest: 'sha256:abc',
    inputFileIds: ['F-IN-1', 'F-IN-2'],
    outputFileIds: ['F-OUT-1'],
    environmentManifestUri: 'https://example.org/manifest.json',
    startedAt: new Date('2026-10-01T10:00:00.000Z'),
    completedAt: new Date('2026-10-01T11:00:00.000Z'),
    runStatus: 'succeeded',
    createdAt: new Date('2026-10-01T09:59:00.000Z'),
  };

  it('maps outputs to target, inputs to source entities, the executor to an author agent and the run times', () => {
    const result = fhirService.toFhirProvenance(run);

    expect(result).toEqual({
      resourceType: 'Provenance',
      id: 'WR-1',
      target: [{ reference: 'DocumentReference/F-OUT-1' }],
      occurredPeriod: { start: '2026-10-01T10:00:00.000Z', end: '2026-10-01T11:00:00.000Z' },
      recorded: '2026-10-01T09:59:00.000Z',
      agent: [{
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author' }] },
        who: { identifier: { value: 'User/u-1' } },
      }],
      entity: [
        { role: 'source', what: { reference: 'DocumentReference/F-IN-1' } },
        { role: 'source', what: { reference: 'DocumentReference/F-IN-2' } },
      ],
    });
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('carries none of the computational environment', () => {
    const text = JSON.stringify(fhirService.toFhirProvenance(run));

    expect(text).not.toContain('WF-1');
    expect(text).not.toContain('sha256:abc');
    expect(text).not.toContain('manifest.json');
    expect(text).not.toContain('succeeded');
  });

  it('leaves out occurredPeriod.end when completedAt is null', () => {
    const result = fhirService.toFhirProvenance({ ...run, completedAt: null });

    expect(result.occurredPeriod.start).toBe('2026-10-01T10:00:00.000Z');
    expect(result.occurredPeriod.end).toBeUndefined();
  });

  it('leaves absent fields undefined and emits no empty array', () => {
    const result = fhirService.toFhirProvenance({
      workflowRunId: 'WR-2', inputFileIds: [], outputFileIds: [], startedAt: new Date('invalid'), completedAt: null,
    });

    ['target', 'entity', 'agent', 'occurredPeriod', 'recorded']
      .forEach((key) => expect(result[key]).toBeUndefined());
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('throws when given no workflow run', () => {
    expect(() => fhirService.toFhirProvenance(null)).toThrow();
    expect(() => fhirService.toFhirProvenance(undefined)).toThrow();
  });
});

describe('FHIRService.toFhirAuditEvent', () => {
  const event = {
    eventId: 'EV-1',
    logId: 'audit-main',
    sequenceNumber: 7,
    occurredAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:01.000Z',
    actorPseudonym: 'actor-ps-1',
    action: 'sample.update',
    entityType: 'Specimen',
    entityId: 'S1',
    result: 'success',
    source: 'api',
    correlationId: 'corr-1',
    purpose: 'operations',
    policyVersion: 'policy-v1',
    payloadDigest: 'digest-1',
    previousEventHash: 'prev-hash-1',
    eventHash: 'hash-1',
    canonicalEventHash: 'hash-1',
  };

  it('maps actor, target, outcome and time of a successful event', () => {
    const result = fhirService.toFhirAuditEvent(event);

    expect(result).toEqual({
      resourceType: 'AuditEvent',
      id: 'EV-1',
      type: { code: 'sample.update' },
      period: { start: '2026-10-01T10:00:00.000Z' },
      recorded: '2026-10-01T10:00:01.000Z',
      outcome: '0',
      purposeOfEvent: [{ text: 'operations' }],
      agent: [{ who: { identifier: { value: 'actor-ps-1' } }, requestor: true }],
      source: { observer: { display: 'api' } },
      entity: [{ what: { identifier: { value: 'S1' }, display: 'Specimen' } }],
    });
    expect(result.outcomeDesc).toBeUndefined();
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('carries no hash chain or internal policy context', () => {
    const text = JSON.stringify(fhirService.toFhirAuditEvent(event));

    ['audit-main', 'corr-1', 'policy-v1', 'digest-1', 'prev-hash-1', 'hash-1'].forEach((value) => {
      expect(text).not.toContain(value);
    });
  });

  it('forces no outcome for a failure and keeps the result as outcomeDesc', () => {
    const result = fhirService.toFhirAuditEvent({ ...event, result: 'failure' });

    expect(result.outcome).toBeUndefined();
    expect(result.outcomeDesc).toBe('failure');
  });

  it('forces no outcome for an attempted event either', () => {
    const result = fhirService.toFhirAuditEvent({ ...event, result: 'attempted' });

    expect(result.outcome).toBeUndefined();
    expect(result.outcomeDesc).toBe('attempted');
  });

  it('names only the entity type when there is no entity id', () => {
    const result = fhirService.toFhirAuditEvent({ eventId: 'EV-2', entityType: 'Study' });

    expect(result.entity).toEqual([{ what: { display: 'Study' } }]);
  });

  it('leaves absent fields undefined and emits no empty array', () => {
    const result = fhirService.toFhirAuditEvent({ eventId: 'EV-3', purpose: '' });

    ['type', 'period', 'recorded', 'outcome', 'outcomeDesc', 'purposeOfEvent', 'agent', 'source', 'entity']
      .forEach((key) => expect(result[key]).toBeUndefined());
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('throws when given no event', () => {
    expect(() => fhirService.toFhirAuditEvent(null)).toThrow();
    expect(() => fhirService.toFhirAuditEvent(undefined)).toThrow();
  });
});

describe('FHIRService.toFhirDocumentReference', () => {
  const file = {
    _id: 'file-oid-1',
    specimenId: 'S1',
    fileName: 'reads.fastq.gz',
    fileRole: 'raw',
    fileFormat: 'application/octet-stream',
    mimeType: 'application/gzip',
    fileSize: 2048,
    storagePath: '/srv/uploads/secret/reads.fastq.gz',
    storageUri: 's3://biobank/files/reads.fastq.gz',
    linkedEntityRefs: [{ entityType: 'Dataset', entityId: 'DS-1' }],
    deletedAt: null,
  };

  it('maps URI, MIME, size, role and context of a current file', () => {
    const result = fhirService.toFhirDocumentReference(file);

    expect(result).toEqual({
      resourceType: 'DocumentReference',
      id: 'file-oid-1',
      status: 'current',
      type: { text: 'raw' },
      content: [{ attachment: { url: 's3://biobank/files/reads.fastq.gz', contentType: 'application/gzip', size: 2048 } }],
      context: {
        related: [
          { identifier: { value: 'S1' }, display: 'Specimen' },
          { identifier: { value: 'DS-1' }, display: 'Dataset' },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('/srv/uploads/secret');
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('never exports the checksum as attachment.hash, nor the storagePath', () => {
    const result = fhirService.toFhirDocumentReference({
      ...file,
      checksum: 'a'.repeat(64),
      checksumAlgorithm: 'SHA-256',
    });

    expect(result.content[0].attachment).not.toHaveProperty('hash');
    const text = JSON.stringify(result);
    expect(text).not.toContain('storagePath');
    expect(text).not.toContain('/srv/uploads/secret');
    expect(text).not.toContain('a'.repeat(64));
  });

  it('gives a logically deleted file no status', () => {
    const result = fhirService.toFhirDocumentReference({ ...file, deletedAt: new Date('2026-10-02T00:00:00.000Z') });

    expect(result.status).toBeUndefined();
  });

  it('lists a Specimen linked ref that repeats specimenId once', () => {
    const result = fhirService.toFhirDocumentReference({
      ...file,
      linkedEntityRefs: [{ entityType: 'Specimen', entityId: 'S1' }, { entityType: 'Dataset', entityId: 'DS-1' }],
    });

    expect(result.context.related).toEqual([
      { identifier: { value: 'S1' }, display: 'Specimen' },
      { identifier: { value: 'DS-1' }, display: 'Dataset' },
    ]);
  });

  it('falls back to fileFormat for the content type', () => {
    const result = fhirService.toFhirDocumentReference({ ...file, mimeType: null });

    expect(result.content[0].attachment.contentType).toBe('application/octet-stream');
  });

  it('leaves absent fields undefined and emits no empty array', () => {
    const result = fhirService.toFhirDocumentReference({ fileId: 42, linkedEntityRefs: [] });

    expect(result.id).toBe('42');
    expect(result.status).toBe('current');
    ['type', 'content', 'context'].forEach((key) => expect(result[key]).toBeUndefined());
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('throws when given no file or a file with no id', () => {
    expect(() => fhirService.toFhirDocumentReference(null)).toThrow();
    expect(() => fhirService.toFhirDocumentReference({ fileRole: 'raw' })).toThrow();
  });
});

describe('FHIRService.toFhirResearchStudy', () => {
  const study = {
    studyId: 'ST-1',
    studyTitle: 'Coorte de biomarcadores',
    studyAcronym: 'CBM',
    studyObjective: 'Avaliar biomarcadores.',
    studyDesign: 'observational',
    studyStatus: 'active',
    principalInvestigator: 'Practitioner/pi-1',
    ethicsApprovalId: ['CAAE-1', 'CAAE-2'],
    protocolId: 'PROT-1',
    protocolVersion: '2.0',
    recruitmentPeriod: { start: '2026-01-01', end: '2026-12-31' },
  };

  it('maps identifier, status, title, protocol and the ethics approvals', () => {
    const result = fhirService.toFhirResearchStudy(study);

    expect(result).toEqual({
      resourceType: 'ResearchStudy',
      id: 'ST-1',
      identifier: [{ value: 'ST-1' }],
      title: 'Coorte de biomarcadores',
      protocol: [{ identifier: { value: 'PROT-1' } }],
      status: 'active',
      description: 'Avaliar biomarcadores.',
      period: { start: '2026-01-01', end: '2026-12-31' },
      principalInvestigator: { identifier: { value: 'Practitioner/pi-1' } },
      relatedArtifact: [
        { type: 'documentation', label: 'CAAE-1' },
        { type: 'documentation', label: 'CAAE-2' },
      ],
    });
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('leaves out a status outside the R4 codes and the R5-only acronym and studyDesign', () => {
    const result = fhirService.toFhirResearchStudy({ ...study, studyStatus: 'paused' });

    expect(result.status).toBeUndefined();
    expect(result).not.toHaveProperty('acronym');
    expect(result).not.toHaveProperty('studyDesign');
    expect(JSON.stringify(result)).not.toContain('CBM');
  });

  it('leaves absent fields undefined and emits no empty array', () => {
    const result = fhirService.toFhirResearchStudy({ studyId: 'ST-2', ethicsApprovalId: [], principalInvestigator: { id: 'x' } });

    ['title', 'protocol', 'status', 'description', 'period', 'principalInvestigator', 'relatedArtifact']
      .forEach((key) => expect(result[key]).toBeUndefined());
    expect(fhirService.validateFHIRResource(result)).toBe(true);
  });

  it('throws when given no study', () => {
    expect(() => fhirService.toFhirResearchStudy(null)).toThrow();
    expect(() => fhirService.toFhirResearchStudy(undefined)).toThrow();
  });
});

describe('FHIRService.EXPORT_ROUND_TRIP_LIMITATIONS', () => {
  it('is frozen and keyed by the four exported resource types', () => {
    const table = fhirService.EXPORT_ROUND_TRIP_LIMITATIONS;

    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.keys(table).sort()).toEqual(['AuditEvent', 'DocumentReference', 'Provenance', 'ResearchStudy']);
    Object.values(table).forEach((list) => {
      expect(Object.isFrozen(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });
  });
});
