import { MongoClient, Db } from 'mongodb';

/**
 * RF029 (#669, #1318): POST /api/ingestion/records now persists through the
 * gateway, but its response names ids only, so — same no-API-surface-to-read-
 * back-through pattern queryFoundationData.ts already uses for RF022/RF028 —
 * this reads the collections the gateway and the route write
 * (ingestionQuarantineRecords, ingestionIdempotencyKeys, the entity stores,
 * graph_projection_outbox, logs) directly from the same Mongo the test stack
 * uses.
 */
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri);
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeIngestionDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function findIngestionQuarantineRecord(ingestionQuarantineRecordId: string): Promise<any> {
  const db = await getDb();
  return db.collection('ingestionQuarantineRecords').findOne({ ingestionQuarantineRecordId });
}

export async function countIngestionQuarantineRecordsByIdempotencyKey(idempotencyKey: string): Promise<number> {
  const db = await getDb();
  return db.collection('ingestionQuarantineRecords').countDocuments({ idempotencyKey });
}

export async function findIngestionIdempotencyKey(idempotencyKey: string, scope: string): Promise<any> {
  const db = await getDb();
  return db.collection('ingestionIdempotencyKeys').findOne({ idempotencyKey, scope });
}

export async function findIngestedRecord(collection: 'datasets' | 'workflowRuns' | 'omicsQualifications' | 'assays' | 'omicsRuns' | 'samples' | 'patients' | 'patientConsents', idField: string, id: string): Promise<any> {
  const db = await getDb();
  return db.collection(collection).findOne({ [idField]: id });
}

export async function countIngestedBySourceRecordId(
  collection: 'datasets' | 'workflowRuns' | 'omicsQualifications' | 'assays' | 'omicsRuns' | 'samples' | 'patients' | 'patientConsents' | 'ingestionQuarantineRecords',
  sourceRecordId: string
): Promise<number> {
  const db = await getDb();
  return db.collection(collection).countDocuments({ sourceRecordId });
}

// #1318: the shared database handle, for a seed helper that takes a Db
// (seedParticipant.ts seedActiveConsentTemplate).
export async function ingestionDb(): Promise<Db> {
  return getDb();
}

// #1318: removes the participants a case ingested, which no API deletes.
export async function deleteIngestedParticipants(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;
  const db = await getDb();
  await db.collection('patients').deleteMany({ participantId: { $in: participantIds } });
}

// #1318: removes the consents a case ingested, with their permission and
// decision rows, which no API deletes.
export async function deleteIngestedConsents(consentIds: string[]): Promise<void> {
  if (consentIds.length === 0) return;
  const db = await getDb();
  await db.collection('consentPermissions').deleteMany({ consentId: { $in: consentIds } });
  await db.collection('consentDecisionEvents').deleteMany({ consentId: { $in: consentIds } });
  await db.collection('patientConsents').deleteMany({ consentId: { $in: consentIds } });
}

// #1318: an ingested consent's decision events, keyed by its consentId.
export async function findConsentDecisionEvents(consentId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('consentDecisionEvents').find({ consentId }).toArray();
}

export async function findOutboxEvents(aggregateId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('graph_projection_outbox').find({ aggregateId, eventType: 'INGESTION_RECORD_PERSISTED' }).toArray();
}

export async function findIngestionAuditRows(action: string, resourceId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('logs').find({ action, resourceId }).toArray();
}

// RF029 AC10: a refusal the route audits itself, keyed by the request's entityType.
export async function findIngestionRefusalRows(resourceType: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('logs').find({ action: 'INGESTION_REFUSED', resourceType }).toArray();
}

// RF029 AC10: a 401 or 403 never reaches the route; the global request audit
// writes its row, named by the request path.
export async function countAccessDenialRows(action: 'UNAUTHORIZED' | 'FORBIDDEN', path: string): Promise<number> {
  const db = await getDb();
  return db.collection('logs').countDocuments({ action, 'payload.path': path });
}

export async function findCanonicalModelRelease(canonicalModelReleaseId: string): Promise<any> {
  const db = await getDb();
  return db.collection('canonicalModelReleases').findOne({ canonicalModelReleaseId });
}

export async function findMissingDataReasons(entityType: string, entityId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('missingDataReasons').find({ entityType, entityId }).toArray();
}

export async function findDataQualityAssessment(dataQualityAssessmentId: string): Promise<any> {
  const db = await getDb();
  return db.collection('dataQualityAssessments').findOne({ dataQualityAssessmentId });
}

export async function countDataQualityAssessmentsByScope(scopeId: string): Promise<number> {
  const db = await getDb();
  return db.collection('dataQualityAssessments').countDocuments({ scopeId });
}

// #1515 (RF009 AC7): the TelemetryIngestionEvent POST /api/iot/telemetry
// screened a reading into, matched by its telemetryReadingId or sourceEventId.
export async function findTelemetryIngestionEvent(filter: Record<string, unknown>): Promise<any> {
  const db = await getDb();
  return db.collection('telemetryIngestionEvents').findOne(filter);
}

// #1515 (RF009 AC7): the TelemetryValidationIssues of one ingestion event.
export async function findTelemetryValidationIssues(ingestionEventId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('telemetryValidationIssues').find({ ingestionEventId }).toArray();
}
