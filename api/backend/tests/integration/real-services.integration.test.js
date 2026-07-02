const { connectDB, closeConnection } = require('../../src/database/mongo');
const { connectNeo4j, closeNeo4jConnection } = require('../../src/infrastructure/database/neo4j/connection');

describe('real services integration', () => {
  let db;
  let neo4j;

  beforeAll(async () => {
    db = await connectDB();
    neo4j = await connectNeo4j();
  });

  afterAll(async () => {
    await closeNeo4jConnection();
    await closeConnection();
  });

  it('uses the deterministic MongoDB seed', async () => {
    const patient = await db.collection('patients').findOne({ syntheticKey: 'BIOAVANCED_SYNTHETIC_TEST_V1:PATIENT' });
    const sample = await db.collection('samples').findOne({ syntheticKey: 'BIOAVANCED_SYNTHETIC_TEST_V1:SAMPLE' });
    expect(patient).toMatchObject({ patientID: 'TEST-PATIENT-001', synthetic: true });
    expect(sample).toMatchObject({ sampleID: 'TEST-SAMPLE-001', patientID: 'TEST-PATIENT-001', synthetic: true });
  });

  it('connects to the real Neo4j service', async () => {
    await expect(neo4j.verifyConnectivity()).resolves.toBeUndefined();
  });

  it('authenticates the seeded administrator through the public API', async () => {
    const response = await fetch('http://127.0.0.1:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.TEST_ADMIN_USERNAME, password: process.env.TEST_ADMIN_PASSWORD }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.token || body.token).toBeTruthy();
  });
});
