import { test, expect } from '@playwright/test';
import { MongoClient, type Db } from 'mongodb';
import { realLogin } from './helpers/realAuth';

// Real-backend proof for #1468: RNF003 C2 (an outage and a maintenance window
// are recorded with start, end, cause and impact) and RNF003 C1/C4 (the
// monthly availability is computed, maintenance announced beforehand left
// out, and published in the operational report). The month is 2000-02, one
// no other spec writes.
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL;
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const MONTH_START = new Date('2000-02-01T00:00:00Z');
const MONTH_END = new Date('2000-03-01T00:00:00Z');

const MAINTENANCE = {
  kind: 'maintenance',
  startedAt: '2000-02-10T02:00:00.000Z',
  endedAt: '2000-02-10T04:00:00.000Z',
  announcedAt: '2000-02-01T00:00:00.000Z',
  cause: 'e2e RNF003: atualização programada',
  impact: 'e2e RNF003: plataforma fora do ar',
};
const OUTAGE = {
  kind: 'outage',
  startedAt: '2000-02-15T10:00:00.000Z',
  endedAt: '2000-02-15T11:00:00.000Z',
  cause: 'e2e RNF003: falha do banco',
  impact: 'e2e RNF003: API indisponível',
};

interface AvailabilityRecord {
  recordId: string;
  kind: string;
  startedAt: string;
  endedAt: string;
  cause: string;
  impact: string;
  announcedAt?: string;
}

test.skip(!apiBaseURL, 'PLAYWRIGHT_API_BASE_URL not set — run via npm run test:e2e:docker');

test.describe('RNF003 availability records and monthly report — real backend', () => {
  const recordIds: string[] = [];
  let client: MongoClient | null = null;

  async function getDb(): Promise<Db> {
    if (!client) {
      client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
      await client.connect();
    }
    return client.db(mongoDbName);
  }

  test.beforeAll(async () => {
    // A run cut off before afterAll leaves its records in 2000-02.
    const db = await getDb();
    await db.collection('availabilityRecords')
      .deleteMany({ startedAt: { $lt: MONTH_END }, endedAt: { $gt: MONTH_START } });
  });

  test.afterAll(async () => {
    const db = await getDb().catch(() => null);
    if (db) {
      await db.collection('availabilityRecords')
        .deleteMany({ recordId: { $in: recordIds } })
        .catch(() => {});
    }
    if (client) await client.close();
  });

  test('an outage and an announced maintenance give the 2000-02 availability (RNF003 C1, C2, C4)', async ({ request }) => {
    const admin = await realLogin(request);
    const auth = { Authorization: `Bearer ${admin.token}` };

    for (const body of [MAINTENANCE, OUTAGE]) {
      const res = await request.post(`${apiBaseURL}/api/availability/records`, { headers: auth, data: body });
      expect(res.status(), await res.text()).toBe(201);
      const created = (await res.json()).data as AvailabilityRecord;
      recordIds.push(created.recordId);
      expect(created).toMatchObject(body);
    }

    const reportRes = await request.get(`${apiBaseURL}/api/availability/report?month=2000-02`, { headers: auth });
    expect(reportRes.status(), await reportRes.text()).toBe(200);
    const report = (await reportRes.json()).data;
    expect(report.maintenanceMinutes).toBe(120);
    expect(report.outageMinutes).toBe(60);
    expect(report.availabilityPercent).toBe(99.8559);
    expect(report.met).toBe(true);
    expect(report.evaluable).toBe(true);

    const listRes = await request.get(`${apiBaseURL}/api/availability/records?month=2000-02`, { headers: auth });
    expect(listRes.status(), await listRes.text()).toBe(200);
    const listed = (await listRes.json()).data as AvailabilityRecord[];
    const pick = ({ startedAt, endedAt, cause, impact }: AvailabilityRecord) => ({ startedAt, endedAt, cause, impact });
    expect(listed.map(pick)).toEqual([MAINTENANCE, OUTAGE].map((r) => pick(r as AvailabilityRecord)));
    expect(listed.map((r) => r.recordId)).toEqual(recordIds);
  });
});
