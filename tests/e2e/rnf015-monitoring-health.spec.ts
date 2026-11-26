import { test, expect, type APIRequestContext } from '@playwright/test';
import { MongoClient, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { realLogin } from './helpers/realAuth';

// Real-backend proof for #1467: RNF003 C3 (GET /api/health reports each
// dependency with its status, criticality and latency), RNF015 C1 (request
// count and latency per route and the queue depths), RNF015 C2 (an alert the
// stack raises on its own evaluation), RNF015 C5 (the recent Foundation and
// reference runs are listed) and RNF015 C6 (a failed run names its phase and
// failed stage).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const DEPENDENCIES = ['mongodb', 'neo4j', 'redis', 'influxdb'] as const;
const DEAD_LETTER_KEY = 'OUTBOX_DEAD_LETTER:graph_projection_outbox';

interface RouteEntry {
  method: string;
  route: string;
  requests: number;
  latency: { count: number };
}

interface MetricsData {
  http: { since: string; totals: { requests: number }; routes: RouteEntry[] };
  queues: { name: string }[];
}

interface RunRow {
  kind: string;
  phase: number;
  id: string | null;
  status: string | null;
  failed: boolean;
  failedStage: string | null;
}

interface RunsData {
  limit: number;
  phases: { phase: number; name: string; failedTotal: number; failedTotalByKind: Record<string, number> }[];
  runs: Record<string, RunRow[]>;
}

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RNF015 monitoring and RNF003 C3 deep health — real backend', () => {
  const outboxEventIds: string[] = [];
  const foundationRunIds: string[] = [];
  let client: MongoClient | null = null;

  async function getDb(): Promise<Db> {
    if (!client) {
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
    }
    return client.db(mongoDbName);
  }

  test.afterAll(async () => {
    const db = await getDb().catch(() => null);
    if (db) {
      await db.collection('graph_projection_outbox')
        .deleteMany({ eventId: { $in: outboxEventIds } })
        .catch(() => {});
      await db.collection('foundationDataRuns')
        .deleteMany({ foundationDataRunId: { $in: foundationRunIds } })
        .catch(() => {});
    }
    if (client) await client.close();
  });

  async function readMetrics(request: APIRequestContext, auth: Record<string, string>): Promise<MetricsData> {
    const res = await request.get(`${apiBaseURL}/api/monitoring/metrics`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).data as MetricsData;
  }

  async function readRuns(request: APIRequestContext, auth: Record<string, string>): Promise<RunsData> {
    const res = await request.get(`${apiBaseURL}/api/monitoring/runs?limit=100`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).data as RunsData;
  }

  const healthRoute = (data: MetricsData) =>
    data.http.routes.find((entry) => entry.method === 'GET' && entry.route === '/api/health');

  test('GET /api/health reports every dependency up with its criticality and latency (RNF003 C3)', async ({ request }) => {
    await realLogin(request);

    await expect.poll(async () => {
      const res = await request.get(`${apiBaseURL}/api/health`);
      const body = await res.json().catch(() => null);
      return DEPENDENCIES.map((name) => body?.checks?.[name]?.status ?? null);
    }, { timeout: 15_000 }).toEqual(['up', 'up', 'up', 'up']);

    const res = await request.get(`${apiBaseURL}/api/health`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('OK');
    expect(body.db).toBe(true);
    expect(body.degraded).toBe(false);
    for (const name of DEPENDENCIES) {
      expect(typeof body.checks[name].critical, name).toBe('boolean');
      expect(typeof body.checks[name].latencyMs, name).toBe('number');
    }
    expect(body.checks.mongodb.critical).toBe(true);
  });

  test('GET /api/monitoring/metrics counts a request on its route and lists the queues (RNF015 C1)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const m0 = await readMetrics(request, auth);
    const before = healthRoute(m0)?.requests ?? 0;

    const health = await request.get(`${apiBaseURL}/api/health`);
    expect(health.status(), await health.text()).toBe(200);

    let latest: MetricsData = m0;
    await expect.poll(async () => {
      latest = await readMetrics(request, auth);
      return healthRoute(latest)?.requests ?? 0;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 1);

    expect(latest.http.totals.requests).toBeGreaterThan(m0.http.totals.requests);
    expect(healthRoute(latest)!.latency.count).toBeGreaterThanOrEqual(1);
    expect(typeof latest.http.since).toBe('string');
    expect(latest.queues.map((queue) => queue.name)).toEqual(
      expect.arrayContaining(['import-queue', 'notification-queue'])
    );
  });

  test('a DEAD_LETTER outbox row raises the critical OUTBOX_DEAD_LETTER alert (RNF015 C2)', async ({ request }) => {
    test.setTimeout(90_000);
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const db = await getDb();

    const eventId = `e2e-1467-${randomUUID()}`;
    const now = new Date();
    outboxEventIds.push(eventId);
    await db.collection('graph_projection_outbox').insertOne({
      eventId,
      aggregateId: `e2e-1467-${randomUUID()}`,
      aggregateType: 'E2EFixture1467',
      aggregateVersion: 1,
      eventType: 'E2E_FIXTURE',
      status: 'DEAD_LETTER',
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      let data: {
        evaluatedAt: string | null;
        results: { key: string; state: string }[] | null;
        active: { alertKey: string; code: string; subject: string; severity: string; value: number; threshold: number }[];
      } = { evaluatedAt: null, results: null, active: [] };
      await expect.poll(async () => {
        const res = await request.get(`${apiBaseURL}/api/monitoring/alerts`, { headers: auth });
        expect(res.status(), await res.text()).toBe(200);
        data = (await res.json()).data;
        return data.active;
      }, { timeout: 60_000, intervals: [2_000] }).toContainEqual(expect.objectContaining({
        alertKey: DEAD_LETTER_KEY,
        code: 'OUTBOX_DEAD_LETTER',
        subject: 'graph_projection_outbox',
        severity: 'critical',
      }));

      const episode = data.active.find((entry) => entry.alertKey === DEAD_LETTER_KEY)!;
      expect(episode.value).toBeGreaterThanOrEqual(1);
      expect(episode.threshold).toBe(0);
      expect(typeof data.evaluatedAt).toBe('string');
      expect(data.results).toContainEqual(expect.objectContaining({ key: DEAD_LETTER_KEY, state: 'firing' }));
    } finally {
      await db.collection('graph_projection_outbox').deleteOne({ eventId });
    }
  });

  test('GET /api/monitoring/runs lists the newest Foundation and reference runs (RNF015 C5)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const db = await getDb();

    const [newestFoundation] = await db.collection('foundationDataRuns')
      .find({}).sort({ startedAt: -1 }).limit(1).toArray();
    const [newestReference] = await db.collection('referenceImportRuns')
      .find({}).sort({ startedAt: -1 }).limit(1).toArray();
    expect(newestFoundation, 'the stack bootstrap wrote a foundationDataRuns document').toBeTruthy();
    expect(newestReference, 'the essential reference job wrote a referenceImportRuns document').toBeTruthy();

    const data = await readRuns(request, auth);
    expect(data.limit).toBe(100);
    expect(data.runs.foundationDataRun.length).toBeGreaterThanOrEqual(1);
    expect(data.runs.referenceImportRun.length).toBeGreaterThanOrEqual(1);
    expect(data.runs.foundationDataRun.map((row) => row.id)).toContain(newestFoundation.foundationDataRunId);
    expect(data.runs.referenceImportRun.map((row) => row.id)).toContain(newestReference.referenceImportRunId);

    for (const row of data.runs.foundationDataRun) {
      expect(row.kind).toBe('foundationDataRun');
      expect(row.phase).toBe(1);
    }
    for (const row of data.runs.referenceImportRun) {
      expect(row.kind).toBe('referenceImportRun');
      expect(row.phase).toBe(2);
    }
  });

  test('a failed Foundation run is listed under phase 1 with its failed stage (RNF015 C6)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const db = await getDb();

    const runId = `e2e-1467-${randomUUID()}`;
    // The old date keeps this run from ever being the newest one, should a
    // crash leave it behind.
    const old = new Date('2000-01-01T00:00:00Z');
    foundationRunIds.push(runId);
    await db.collection('foundationDataRuns').insertOne({
      foundationDataRunId: runId,
      runStatus: 'failed',
      executionMode: 'apply',
      dryRunResult: 'pass',
      applyResult: 'fail',
      verifyResult: 'not_run',
      rollbackResult: 'not_required',
      startedAt: old,
      completedAt: old,
      initiatedBy: 'e2e:1467',
    });

    try {
      // limit=100 reaches the inserted row only while the collection holds fewer than 100.
      expect(await db.collection('foundationDataRuns').countDocuments()).toBeLessThan(100);

      const data = await readRuns(request, auth);
      const row = data.runs.foundationDataRun.find((entry) => entry.id === runId);
      expect(row, 'the inserted failed run is listed').toBeTruthy();
      expect(row).toMatchObject({
        kind: 'foundationDataRun',
        phase: 1,
        status: 'failed',
        failed: true,
        failedStage: 'apply',
      });

      const foundation = data.phases.find((phase) => phase.phase === 1);
      expect(foundation).toMatchObject({ name: 'foundation' });
      expect(foundation!.failedTotal).toBeGreaterThanOrEqual(1);
      expect(foundation!.failedTotalByKind.foundationDataRun).toBeGreaterThanOrEqual(1);
    } finally {
      await db.collection('foundationDataRuns').deleteOne({ foundationDataRunId: runId });
    }
  });
});
