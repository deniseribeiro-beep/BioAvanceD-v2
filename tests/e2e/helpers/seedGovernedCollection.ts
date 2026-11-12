import { MongoClient, Db } from 'mongodb';
import { expect, type APIRequestContext } from '@playwright/test';

/**
 * #1497 (RF004 AC2, ELM-0118 Specimen.collectionId 1..1): a collection a
 * spec's specimens are registered into, written to the test stack's Mongo the
 * way seedCustody.ts does (same URI, same direct connection).
 *
 * A biobank, not a biorepository: the registration gate then reads only the
 * regime, the biobank context id and an approval in force, and never compares
 * a specimen's studyId or protocolId against a context (RF004 AC4).
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

export async function closeGovernedCollectionDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export type GovernedCollection = { collectionId: string; approvalId: string };

export async function seedGovernedCollection(suffix: string): Promise<GovernedCollection> {
  const db = await getDb();
  const fixture = { collectionId: `COL-GOV-${suffix}`, approvalId: `APPR-GOV-${suffix}` };
  await db.collection('collections').insertOne({
    collectionId: fixture.collectionId,
    collectionName: `Coleção e2e ${suffix}`,
    collectionStatus: 'active',
    governanceRegime: 'biobank',
    governanceContext: { biobankGovernanceContextId: `BGC-${suffix}` },
    createdAt: new Date(),
  });
  await db.collection('collectionGovernanceApprovals').insertOne({
    approvalId: fixture.approvalId,
    collectionId: fixture.collectionId,
    status: 'active',
    effectivePeriod: { start: '2025-01-01T00:00:00.000Z', end: null },
    createdAt: new Date(),
  });
  return fixture;
}

/** Removes the collection, its approval and every custody that approval authorized. */
export async function cleanupGovernedCollection(fixture: GovernedCollection | null): Promise<void> {
  if (!fixture) return;
  const db = await getDb();
  await Promise.all([
    db.collection('collections').deleteMany({ collectionId: fixture.collectionId }),
    db.collection('collectionGovernanceApprovals').deleteMany({ approvalId: fixture.approvalId }),
    db.collection('custodianshipAssignments').deleteMany({ authorizationId: fixture.approvalId }),
  ]);
}

/**
 * RF021 AC6: a specimen in a collection is released for use only while a
 * custody holds it under an approval in force. Assigns that custody through
 * the physical-chain route, as physical-chain.spec.ts does, authorized by the
 * governed collection's approval.
 */
export async function assignGovernedCustody(
  request: APIRequestContext,
  apiBaseURL: string,
  headers: Record<string, string>,
  fixture: GovernedCollection,
  specimenId: string,
  custodianOrganizationId: string,
): Promise<void> {
  const assigned = await request.post(`${apiBaseURL}/api/physical-chain/custody`, {
    headers,
    data: {
      specimenId,
      custodianOrganizationId,
      authorizationId: fixture.approvalId,
      effectivePeriod: { start: '2026-01-01T00:00:00.000Z' },
    },
  });
  expect(assigned.status(), await assigned.text()).toBe(201);
}
