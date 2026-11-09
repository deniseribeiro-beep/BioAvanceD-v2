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

/** #1481 RF029 AC6: an EthicalConsent node's own properties and the ids of the Donor nodes CONSENTED_UNDER it. */
export async function readConsentProjection(consentId: string): Promise<{ consent: Record<string, unknown> | null; donorIds: string[] }> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (c:EthicalConsent {id: $consentId}) OPTIONAL MATCH (d:Donor)-[:CONSENTED_UNDER]->(c) RETURN properties(c) AS consent, collect(d.id) AS donorIds',
      { consentId }
    );
    if (result.records.length === 0) return { consent: null, donorIds: [] };
    return { consent: result.records[0].get('consent'), donorIds: result.records[0].get('donorIds') };
  } finally {
    await session.close();
  }
}

/** #1500 (RF023 AC5): one STORED_AT placement edge into a box, its times as ISO strings. */
export interface StoredAtEdge {
  sampleId: string | null;
  position: string | null;
  validFrom: string | null;
  validTo: string | null;
  transactionTime: string | null;
}

/** #1500 (RF023 AC5): every Sample-[:STORED_AT]->StoragePosition edge into `boxId`. */
export async function readStoredAtEdges(boxId: string): Promise<StoredAtEdge[]> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (s:Sample)-[r:STORED_AT]->(p:StoragePosition {boxId: $boxId}) ' +
        'RETURN s.id AS sampleId, p.position AS position, toString(r.validFrom) AS validFrom, ' +
        'toString(r.validTo) AS validTo, toString(r.transactionTime) AS transactionTime',
      { boxId }
    );
    return result.records.map((record) => ({
      sampleId: record.get('sampleId') ?? null,
      position: record.get('position') ?? null,
      validFrom: record.get('validFrom') ?? null,
      validTo: record.get('validTo') ?? null,
      transactionTime: record.get('transactionTime') ?? null,
    }));
  } finally {
    await session.close();
  }
}

/** #1500: polls until a STORED_AT edge into `boxId` exists and returns the edges, or throws on timeout. */
export async function waitForStoredAtEdge(
  boxId: string,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<StoredAtEdge[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const edges = await readStoredAtEdges(boxId);
    if (edges.length > 0) {
      return edges;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitForStoredAtEdge: timed out after ${timeoutMs}ms waiting for a STORED_AT edge into box ${boxId}`);
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

/**
 * RF028 AC9 (#552) fixture: proves the graph_projection_outbox → Neo4j
 * projection pipeline runs for TerminologyConcept promotions too, not just
 * RF023's consent/lineage/quality/telemetry events — same generic worker
 * (neo4jProjection.worker.js), a new event type
 * (TERMINOLOGY_CONCEPT_PROMOTED) and Cypher branch
 * (neo4jCanonicalProjection.service.js's applyTerminologyConceptProjection).
 * Queried by code+systemUri, not terminologyConceptId — the Mongo id is a
 * random UUID unknown ahead of time, but code+systemUri is the source's own
 * stable natural key (see TerminologyConcept.js's logical-key comment).
 */
async function readTerminologyConceptDisplay(code: string, systemUri: string): Promise<string | null> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (c:TerminologyConcept {code: $code, systemUri: $systemUri}) RETURN c.display AS display',
      { code, systemUri }
    );
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('display');
  } finally {
    await session.close();
  }
}

/** Polls Neo4j until the projected `:TerminologyConcept` node reaches `expectedDisplay`, or throws once `timeoutMs` elapses. */
export async function waitForTerminologyConceptNode(
  code: string,
  systemUri: string,
  expectedDisplay: string,
  { timeoutMs = 30_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string | null = null;

  while (Date.now() < deadline) {
    lastSeen = await readTerminologyConceptDisplay(code, systemUri);
    if (lastSeen === expectedDisplay) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForTerminologyConceptNode: timed out after ${timeoutMs}ms waiting for TerminologyConcept ` +
      `${systemUri}#${code} to reach display "${expectedDisplay}" (last seen: ${lastSeen ?? 'no node found'})`
  );
}

async function readTerminologyRelationType(sourceCode: string, targetCode: string, systemUri: string): Promise<string | null> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      `MATCH (a:TerminologyConcept {code: $sourceCode, systemUri: $systemUri})
             -[r:TERMINOLOGY_RELATION]->
             (b:TerminologyConcept {code: $targetCode, systemUri: $systemUri})
       RETURN r.relationType AS relationType`,
      { sourceCode, targetCode, systemUri }
    );
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0].get('relationType');
  } finally {
    await session.close();
  }
}

/** Polls Neo4j until the `sourceCode -[TERMINOLOGY_RELATION]-> targetCode` edge reaches `expectedRelationType`, or throws once `timeoutMs` elapses. */
/**
 * #696 (RF005 AC4-6 real-backend proof) fixture: seeds the `Doenca_ORPHA`
 * -[:APRESENTA_FENOTIPO]-> `Fenotipo_HPO` graph shape `GET
 * /api/dictionary/suggest` (dictionary.js) queries directly against Neo4j
 * to populate the intake wizard's disease-phenotype cascade. This is a
 * different, older graph model from RF028/RF023's own
 * `:TerminologyConcept`/`:TerminologyRelation` projection (no cross-
 * reference from ORPHA to HPO exists in RF028's bundled sample fixtures,
 * which only carry each ontology's own intra-hierarchy `is_a` edges) — so
 * seeding this graph directly, the same "seed the referent directly"
 * rationale as `seedSampleNode` above, is the only way to get the
 * wizard's phenotype-suggestion step to return real data against a real
 * backend without depending on Neo4j actually erroring (the only other
 * path into `buildLocalSemanticSuggestions`' Mongo fallback).
 */
export async function seedOrphaPhenotypeGraph(
  orphaCode: string,
  orphaLabel: string,
  phenotypes: Array<{ hpoCode: string; label: string }>
): Promise<void> {
  const session = getDriver().session({ database });
  try {
    await session.run('MERGE (d:Doenca_ORPHA {code: $orphaCode}) SET d.nome = $orphaLabel', {
      orphaCode,
      orphaLabel,
    });
    for (const phenotype of phenotypes) {
      await session.run(
        `
          MERGE (h:Fenotipo_HPO {code: $hpoCode})
          SET h.nome = $label
          WITH h
          MATCH (d:Doenca_ORPHA {code: $orphaCode})
          MERGE (d)-[:APRESENTA_FENOTIPO]->(h)
        `,
        { hpoCode: phenotype.hpoCode, label: phenotype.label, orphaCode }
      );
    }
  } finally {
    await session.close();
  }
}

/** Deletes a seeded `:Doenca_ORPHA` node and its `:Fenotipo_HPO` phenotypes — call from a spec's cleanup so fixtures don't accumulate across runs. */
export async function removeOrphaPhenotypeGraph(orphaCode: string): Promise<void> {
  const session = getDriver().session({ database });
  try {
    await session.run(
      `
        MATCH (d:Doenca_ORPHA {code: $orphaCode})
        OPTIONAL MATCH (d)-[:APRESENTA_FENOTIPO]->(h:Fenotipo_HPO)
        DETACH DELETE d, h
      `,
      { orphaCode }
    );
  } finally {
    await session.close();
  }
}

export async function waitForTerminologyRelation(
  sourceCode: string,
  targetCode: string,
  systemUri: string,
  expectedRelationType: string,
  { timeoutMs = 30_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string | null = null;

  while (Date.now() < deadline) {
    lastSeen = await readTerminologyRelationType(sourceCode, targetCode, systemUri);
    if (lastSeen === expectedRelationType) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForTerminologyRelation: timed out after ${timeoutMs}ms waiting for ${sourceCode} ` +
      `-[TERMINOLOGY_RELATION]-> ${targetCode} to reach relationType "${expectedRelationType}" ` +
      `(last seen: ${lastSeen ?? 'no relation found'})`
  );
}

async function readGovernedByConsentIds(sampleId: string): Promise<string[]> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (:Sample {id: $sampleId})-[:GOVERNED_BY]->(c:EthicalConsent) RETURN c.id AS consentId',
      { sampleId }
    );
    return result.records.map((record) => String(record.get('consentId')));
  } finally {
    await session.close();
  }
}

/**
 * #1225 fixture: polls Neo4j until `(:Sample {id: sampleId})-[:GOVERNED_BY]->
 * (:EthicalConsent {id: consentId})` exists, or throws once `timeoutMs`
 * elapses. `sampleId` is the key the sample and custody projections MERGE
 * the sample under (the Mongo _id). Both events are projected asynchronously by
 * the outbox worker, and either may land first.
 */
export async function waitForSampleGovernedBy(
  sampleId: string,
  consentId: string,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen: string[] = [];

  while (Date.now() < deadline) {
    lastSeen = await readGovernedByConsentIds(sampleId);
    if (lastSeen.includes(consentId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForSampleGovernedBy: timed out after ${timeoutMs}ms waiting for Sample ${sampleId} ` +
      `-[GOVERNED_BY]-> EthicalConsent ${consentId} (last seen: ${lastSeen.length ? lastSeen.join(', ') : 'no GOVERNED_BY edge'})`
  );
}

async function countDerivedFromEdges(childId: string, parentId: string): Promise<number> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run(
      'MATCH (c:Sample {id: $childId})-[:DERIVED_FROM]->(p:Sample {id: $parentId}) RETURN count(*) AS n',
      { childId, parentId }
    );
    return Number(result.records[0].get('n'));
  } finally {
    await session.close();
  }
}

/**
 * #1368 fixture: polls Neo4j until `(:Sample {id: childId})-[:DERIVED_FROM]->
 * (:Sample {id: parentId})` exists, or throws once `timeoutMs` elapses. Both
 * ids are Mongo _id strings, the key the projector MERGEs a LINEAGE_REGISTERED
 * edge under; the event is projected asynchronously by the outbox worker.
 */
export async function waitForDerivedFrom(
  childId: string,
  parentId: string,
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = 0;

  while (Date.now() < deadline) {
    lastSeen = await countDerivedFromEdges(childId, parentId);
    if (lastSeen > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForDerivedFrom: timed out after ${timeoutMs}ms waiting for Sample ${childId} ` +
      `-[DERIVED_FROM]-> Sample ${parentId} (last seen: no DERIVED_FROM edge)`
  );
}

/** Counts `:Sample` nodes with the given id — #1225's phantom-node check (a consent id must never key a Sample). */
export async function countSampleNodes(sampleId: string): Promise<number> {
  const session = getDriver().session({ database });
  try {
    const result = await session.run('MATCH (s:Sample {id: $sampleId}) RETURN count(s) AS n', { sampleId });
    return Number(result.records[0].get('n'));
  } finally {
    await session.close();
  }
}

/** #1325: every node and relationship in the database, the scope of the backup's Neo4j export. */
export async function countGraph(): Promise<{ nodes: number; relationships: number }> {
  const session = getDriver().session({ database });
  try {
    const nodes = await session.run('MATCH (n) RETURN count(n) AS n');
    const relationships = await session.run('MATCH ()-[r]->() RETURN count(r) AS n');
    return { nodes: Number(nodes.records[0].get('n')), relationships: Number(relationships.records[0].get('n')) };
  } finally {
    await session.close();
  }
}
