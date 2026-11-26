import crypto from 'crypto';
import { MongoClient, Db } from 'mongodb';

/**
 * #1524 fixture for specimen-quality-inventory.spec.ts (RNF018 AC5): the
 * monitoring and documentation records a certification's governance
 * evidence references resolve against, written to the test stack's Mongo
 * the way seedCustody.ts does (same URI, same direct connection).
 *
 * The telemetry summary carries every field TelemetryExposureSummary.js
 * requires, with values its create() accepts; the approval carries the
 * approvalId, status, documentUri and documentChecksum the evidence
 * resolver reads.
 */

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeGovernanceEvidenceDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

function sha256(seed: string): string {
  return `sha256:${crypto.createHash('sha256').update(seed).digest('hex')}`;
}

const seededSummaryIds: string[] = [];
const seededApprovalIds: string[] = [];

export type SeededTelemetrySummary = { telemetryExposureSummaryId: string; sourceReadingSetHash: string };
export type SeededApprovalDocument = { approvalId: string; documentChecksum: string };

/** A TelemetryExposureSummary of the specimen, as V2E-0529 monitoring evidence. */
export async function seedTelemetrySummary(specimenId: string): Promise<SeededTelemetrySummary> {
  const db = await getDb();
  const telemetryExposureSummaryId = `TES-1524-${crypto.randomUUID()}`;
  const sourceReadingSetHash = sha256(`readings:${telemetryExposureSummaryId}`);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000);
  await db.collection('telemetryExposureSummaries').insertOne({
    telemetryExposureSummaryId,
    specimenId,
    storageAssignmentId: null,
    datastreamIds: [`DS-1524-${telemetryExposureSummaryId}`],
    windowStart,
    windowEnd,
    observationCount: 4,
    minimumValue: -80.4,
    maximumValue: -79.6,
    meanValue: -80,
    timeOutsideThresholdSeconds: 0,
    excursionCount: 0,
    coverageRatio: 1,
    sourceQueryHash: sha256(`query:${telemetryExposureSummaryId}`),
    sourceReadingSetHash,
    calculationVersion: '1.0.0',
    calculatedAt: windowEnd,
    specimenContainerAssignmentId: `SCA-1524-${telemetryExposureSummaryId}`,
    containerPositionAssignmentId: `CPA-1524-${telemetryExposureSummaryId}`,
    rackLocationAssignmentId: `RLA-1524-${telemetryExposureSummaryId}`,
    exposurePathHash: sha256(`path:${telemetryExposureSummaryId}`),
  });
  seededSummaryIds.push(telemetryExposureSummaryId);
  return { telemetryExposureSummaryId, sourceReadingSetHash };
}

/**
 * A CollectionGovernanceApproval of collectionId with its document checksum,
 * as V2E-0530 documentation evidence: a documentation reference resolves only
 * to an approval of the specimen's collection (RNF018 AC5, #1524).
 */
export async function seedApprovalDocument(collectionId: string): Promise<SeededApprovalDocument> {
  const db = await getDb();
  const approvalId = `APPR-1524-${crypto.randomUUID()}`;
  const documentChecksum = sha256(`document:${approvalId}`);
  await db.collection('collectionGovernanceApprovals').insertOne({
    approvalId,
    collectionId,
    authority: 'CEP 1524 e2e',
    status: 'active',
    documentUri: `https://example.org/approvals/${approvalId}.pdf`,
    documentChecksum,
    effectivePeriod: { start: '2025-01-01T00:00:00.000Z', end: null },
    responsibleOrganizationId: 'ORG-1524',
    createdAt: new Date(),
  });
  seededApprovalIds.push(approvalId);
  return { approvalId, documentChecksum };
}

/** Removes every summary and approval this helper wrote. */
export async function cleanupGovernanceEvidence(): Promise<void> {
  if (!seededSummaryIds.length && !seededApprovalIds.length) return;
  const db = await getDb();
  await Promise.all([
    db.collection('telemetryExposureSummaries').deleteMany({ telemetryExposureSummaryId: { $in: [...seededSummaryIds] } }),
    db.collection('collectionGovernanceApprovals').deleteMany({ approvalId: { $in: [...seededApprovalIds] } }),
  ]);
  seededSummaryIds.length = 0;
  seededApprovalIds.length = 0;
}
