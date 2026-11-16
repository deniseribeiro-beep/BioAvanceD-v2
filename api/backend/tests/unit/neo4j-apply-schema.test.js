// #1557 (RNF016 C7): the declared Neo4j schema is read from both .cypher
// files, each statement must be an idempotent CREATE ... IF NOT EXISTS, and
// the apply runs every statement in one session that it always closes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA_FILES,
  schemaStatements,
  applyNeo4jSchema,
} = require('../../src/infrastructure/database/neo4j/schema/applySchema');

const SCHEMA_DIR = path.resolve(__dirname, '../../src/infrastructure/database/neo4j/schema');

describe('#1557 applyNeo4jSchema', () => {
  let session;
  let driver;
  const tempDirs = [];

  function tempSchemaDir(first, second = '') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo4j-schema-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, SCHEMA_FILES[0]), first);
    fs.writeFileSync(path.join(dir, SCHEMA_FILES[1]), second);
    return dir;
  }

  beforeEach(() => {
    session = { run: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    driver = { session: () => session };
  });

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('applies the real files', async () => {
    await expect(applyNeo4jSchema(driver)).resolves.toEqual({ applied: 18 });

    expect(session.run).toHaveBeenCalledTimes(18);
    expect(session.run.mock.calls[0][0]).toMatch(/^CREATE CONSTRAINT donor_id_unique IF NOT EXISTS/);
    expect(session.run.mock.calls[17][0]).toMatch(/^CREATE INDEX telemetry_incident_status_idx IF NOT EXISTS/);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('splits 13 constraints and 5 indexes', () => {
    const statements = schemaStatements();

    expect(statements.filter((s) => /^CREATE CONSTRAINT/.test(s))).toHaveLength(13);
    expect(statements.filter((s) => /^CREATE INDEX/.test(s))).toHaveLength(5);
    expect(statements).toHaveLength(18);
  });

  it('refuses a non-idempotent statement', async () => {
    const dir = tempSchemaDir('CREATE CONSTRAINT b FOR (s:Sample) REQUIRE s.id IS UNIQUE;\n');

    await expect(applyNeo4jSchema(driver, { dir })).rejects.toThrow(/not an idempotent/);
    expect(session.run).toHaveBeenCalledTimes(0);
  });

  it('closes the session when a run fails', async () => {
    session.run.mockRejectedValue(new Error('ConstraintCreationFailed'));

    await expect(applyNeo4jSchema(driver)).rejects.toThrow('ConstraintCreationFailed');
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('reads CRLF files', () => {
    const text = fs.readFileSync(path.join(SCHEMA_DIR, SCHEMA_FILES[0]), 'utf8').replace(/\r?\n/g, '\r\n');
    const dir = tempSchemaDir(text);

    const statements = schemaStatements(dir);

    expect(statements).toHaveLength(18);
    expect(statements.filter((s) => s.includes('\r'))).toEqual([]);
  });
});
