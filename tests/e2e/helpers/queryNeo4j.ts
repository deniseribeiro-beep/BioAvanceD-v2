import neo4j, { Driver } from 'neo4j-driver';

/**
 * RF023 (#292) fixture: proves the graph_projection_outbox → Neo4j
 * projection pipeline (neo4jOutbox.service.js / neo4jProjection.worker.js /
 * neo4jCanonicalProjection.service.js) actually runs, not just that the
 * outbox row was written — reading the projected node back from the real
 * Neo4j instance is the only way to tell an accepted event from a silently
 * stuck/dead-lettered one.
 *
 * Env vars mirror compose.test.yml's neo4j-test block, except the URI: the
 * backend/worker containers talk to `neo4j-test:7687` on the compose
 * network, but Playwright runs from the host (same reasoning as
 * seedParticipant.ts's Mongo helper and queryInflux.ts's InfluxDB helper),
 * so this defaults to localhost against the published port added alongside
 * this spec.
 */

const uri = process.env.E2E_NEO4J_URI || 'bolt://localhost:7687';
const username = process.env.E2E_NEO4J_USERNAME || 'neo4j';
const password = process.env.E2E_NEO4J_PASSWORD || 'testpassword';
// neo4j:5-community only supports the default `neo4j` database — named
// databases are an Enterprise-only feature (#292: compose.test.yml's
// NEO4J_DATABASE used to say bioavanced_test, which doesn't exist).
const database = process.env.E2E_NEO4J_DATABASE || 'neo4j';

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }
  return driver;
}

/** Closes the shared Neo4j driver — call once from a suite's afterAll. */
export async function closeNeo4jDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

async function readEthicalConsentStatus(consentId: string): Promise<string | null> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (c:EthicalConsent {id: $consentId}) RETURN c.status AS status',
      { consentId }
    );
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('status');
  } finally {
    await session.close();
  }
}

/**
 * Polls Neo4j until the projected `:EthicalConsent` node for `consentId`
 * reaches `expectedStatus`, or throws once `timeoutMs` elapses. The outbox
 * worker (neo4j-projection-worker-test, compose.test.yml) polls on a ~1s
 * interval (GRAPH_OUTBOX_RETRY_BACKOFF_MS), so this deliberately doesn't
 * assert on the first read — the projection is genuinely asynchronous.
 */
export async function waitForEthicalConsentStatus(
  consentId: string,
  expectedStatus: string,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string | null = null;

  while (Date.now() < deadline) {
    lastSeen = await readEthicalConsentStatus(consentId);
    if (lastSeen === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForEthicalConsentStatus: timed out after ${timeoutMs}ms waiting for EthicalConsent ` +
      `${consentId} to reach status ${expectedStatus} (last seen: ${lastSeen ?? 'no node found'})`
  );
}

/**
 * RF009 (#304) fixture: seeds a bare `:Sample {id}` node plus an optional
 * `DERIVED_FROM` edge to a parent's node, so propagateCompromise's
 * descendant-traversal write has a real graph to walk without needing the
 * full outbox projection pipeline (RF023/#292) to run first — this issue
 * only proves the Neo4j write itself, not the projection path.
 */
export async function seedSampleNode(sampleId: string, parentSampleId?: string): Promise<void> {
  const session = getDriver().session({ database });
  try {
    await session.run('MERGE (s:Sample {id: $sampleId})', { sampleId });
    if (parentSampleId) {
      await session.run(
        `
          MERGE (child:Sample {id: $sampleId})
          MERGE (parent:Sample {id: $parentSampleId})
          MERGE (child)-[:DERIVED_FROM]->(parent)
        `,
        { sampleId, parentSampleId }
      );
    }
  } finally {
    await session.close();
  }
}

/** Reads back a `:Sample` node's status property (null if the node doesn't exist). */
export async function readSampleStatus(sampleId: string): Promise<string | null> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run('MATCH (s:Sample {id: $sampleId}) RETURN s.status AS status', { sampleId });
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('status');
  } finally {
    await session.close();
  }
}

/** Deletes seeded `:Sample` nodes by id — call from a spec's cleanup so fixtures don't accumulate across runs. */
export async function removeSampleNodes(sampleIds: string[]): Promise<void> {
  const session = getDriver().session({ database });
  try {
    await session.run('MATCH (s:Sample) WHERE s.id IN $sampleIds DETACH DELETE s', { sampleIds });
  } finally {
    await session.close();
  }
}
