import { test, expect, type APIRequestContext } from '@playwright/test';
import { MongoClient, type Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { realLogin } from './helpers/realAuth';

// Real-backend proof for #1468: RNF015 C7 (GET /api/monitoring/metrics serves
// the metrics in the Prometheus text format for an equivalent tool to scrape)
// and RNF015 C1/C3 (a worker job run is counted in the job metrics, in the
// JSON and in the text format).
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const PROJECTION_WORKER = 'neo4j-projection';
const PROJECTION_JOB = 'project-event';

interface JobRow {
  worker: string;
  job: string;
  completed: number;
  failed: number;
}

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RNF015 C7 metrics export — real backend', () => {
  let client: MongoClient | null = null;

  async function getDb(): Promise<Db> {
    if (!client) {
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
    }
    return client.db(mongoDbName);
  }

  test.afterAll(async () => {
    if (client) await client.close();
  });

  async function readJobs(request: APIRequestContext, auth: Record<string, string>): Promise<JobRow[] | null> {
    const res = await request.get(`${apiBaseURL}/api/monitoring/metrics`, { headers: auth });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).data.jobs as JobRow[] | null;
  }

  function projectionRuns(jobs: JobRow[] | null): number {
    const row = (jobs ?? []).find((entry) => entry.worker === PROJECTION_WORKER && entry.job === PROJECTION_JOB);
    return row ? row.completed + row.failed : 0;
  }

  async function readPrometheus(request: APIRequestContext, auth: Record<string, string>): Promise<string> {
    const res = await request.get(`${apiBaseURL}/api/monitoring/metrics?format=prometheus`, { headers: auth });
    const text = await res.text();
    expect(res.status(), text).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^text\/plain/);
    return text;
  }

  test('GET /api/monitoring/metrics?format=prometheus serves the metrics as text (RNF015 C7)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const text = await readPrometheus(request, auth);

    expect(text).toContain('# TYPE bioavanced_http_requests_total counter');
    expect(text).toMatch(/^bioavanced_queue_up\{queue="import-queue"\} [01]$/m);
  });

  test('a projected outbox event is counted in the worker job metrics (RNF015 C1/C3, C7)', async ({ request }) => {
    test.setTimeout(90_000);
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const db = await getDb();

    const before = projectionRuns(await readJobs(request, auth));

    const eventId = `e2e-1468-${randomUUID()}`;
    const now = new Date();
    // PENDING, no attempts and no backoff: the next lease picks it up.
    await db.collection('graph_projection_outbox').insertOne({
      eventId,
      aggregateId: `e2e-1468-${randomUUID()}`,
      aggregateType: 'E2EFixture1468',
      aggregateVersion: 1,
      eventType: 'E2E_FIXTURE',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: null,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await expect.poll(async () => projectionRuns(await readJobs(request, auth)), {
        timeout: 60_000,
        intervals: [2_000],
      }).toBeGreaterThan(before);

      const text = await readPrometheus(request, auth);
      expect(text).toContain(`bioavanced_worker_jobs_total{worker="${PROJECTION_WORKER}",job="${PROJECTION_JOB}"`);
      expect(text).toMatch(/^bioavanced_worker_metrics_up 1$/m);
    } finally {
      // A fixture left to retry would dead-letter and raise the outbox alert.
      await db.collection('graph_projection_outbox').deleteOne({ eventId });
    }
  });
});
