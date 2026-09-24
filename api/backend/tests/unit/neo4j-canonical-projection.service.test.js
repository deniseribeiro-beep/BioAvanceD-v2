const { makeAuthToken, makeLegacyClaimsToken, buildAuthenticatedCollections, userForAccessType, TEST_USER_ACCOUNT_IDS } = require('../../factories/auth.factory');
const { Neo4jCanonicalProjectionService } = require('../../src/services/neo4jCanonicalProjection.service');

describe('Neo4jCanonicalProjectionService', () => {
  beforeEach(() => {
    process.env.NEO4J_CANONICAL_SALT = 'canonical-test-salt';
  });

  it('pseudonymizes donor ids deterministically and with salt separation', () => {
    const service = new Neo4jCanonicalProjectionService();
    const donorA = service.pseudonymizeDonorId('patient-123');
    const donorB = service.pseudonymizeDonorId('patient-123');

    expect(donorA).toBe(donorB);
    expect(donorA).toMatch(/^DONOR_[a-f0-9]{24}$/);

    process.env.NEO4J_CANONICAL_SALT = 'another-salt';
    const service2 = new Neo4jCanonicalProjectionService();
    expect(service2.pseudonymizeDonorId('patient-123')).not.toBe(donorA);
  });

  it('projects consent without direct identifiers in the cypher payload', async () => {
    const service = new Neo4jCanonicalProjectionService();
    const runs = [];
    const session = { run: async (cypher, params) => { runs.push({ cypher, params }); return { records: [] }; } };

    await service.applyConsentProjection(session, {
      eventId: 'evt-1',
      eventType: 'CONSENT_UPSERTED',
      aggregateType: 'EthicalConsent',
      aggregateId: 'consent-1',
      schemaVersion: 1,
      sourceService: 'unit-test',
      occurredAt: '2026-07-01T12:00:00.000Z',
      payload: {
        donorKey: 'patient-123',
        specimenId: 'sample-1',
        status: 'ACTIVE',
      }
    });

    expect(runs).toHaveLength(1);
    expect(runs[0].cypher).not.toMatch(/cpf|email|prontu|nome|patientId/i);
    expect(runs[0].params.donorId).toMatch(/^DONOR_[a-f0-9]{24}$/);
    expect(runs[0].params.specimenId).toBe('sample-1');
    expect(runs[0].params.consentId).toBe('consent-1');
  });

  it('projects lineage, quality and telemetry events idempotently by canonical identifiers', async () => {
    const service = new Neo4jCanonicalProjectionService();
    const calls = [];
    const session = { run: async (cypher, params) => { calls.push({ cypher, params }); return { records: [] }; } };

    await service.applyLineageProjection(session, {
      eventId: 'lineage-1',
      eventType: 'LINEAGE_REGISTERED',
      aggregateType: 'Sample',
      aggregateId: 'sample-child',
      schemaVersion: 1,
      sourceService: 'unit-test',
      payload: { specimenId: 'sample-child', parentSpecimenId: 'sample-parent' }
    });

    await service.applyQualityProjection(session, {
      eventId: 'quality-1',
      eventType: 'QUALITY_ASSESSED',
      aggregateType: 'Sample',
      aggregateId: 'sample-child',
      schemaVersion: 1,
      sourceService: 'unit-test',
      payload: { specimenId: 'sample-child', qualityAssessmentId: TEST_USER_ACCOUNT_IDS[4], status: 'GOOD', score: 98 }
    });

    await service.applyTelemetryProjection(session, {
      eventId: 'telemetry-1',
      eventType: 'TELEMETRY_INCIDENT_RECORDED',
      aggregateType: 'Sample',
      aggregateId: 'sample-child',
      schemaVersion: 1,
      sourceService: 'unit-test',
      payload: { specimenId: 'sample-child', telemetryIncidentId: 'ti-1', severity: 'HIGH', status: 'OPEN' }
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].params.specimenId).toBe('sample-child');
    expect(calls[0].params.parentSpecimenId).toBe('sample-parent');
    expect(calls[1].params.assessmentId).toBe(TEST_USER_ACCOUNT_IDS[4]);
    expect(calls[2].params.incidentId).toBe('ti-1');
  });
});
