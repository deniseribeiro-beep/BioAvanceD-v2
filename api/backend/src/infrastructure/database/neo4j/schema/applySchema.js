// #1557 (RNF016 C7): applies the declared Neo4j schema, the uniqueness
// constraints and indexes behind the projector's MERGE keys. The projection
// worker runs it once at startup, before its first lease, so every stack's
// graph carries the constraints the .cypher files in this directory declare.
//
// Each statement must be `CREATE CONSTRAINT|INDEX <name> IF NOT EXISTS`:
// the step runs on every worker start, so a statement that is not idempotent
// is refused before any of them runs. This module writes schema only, never
// a node or an edge.
const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = __dirname;
const SCHEMA_FILES = [
  '001_iso20387_constraints_indexes.cypher',
  '002_canonical_projection.cypher',
];
const IDEMPOTENT = /^CREATE\s+(?:CONSTRAINT|INDEX)\s+\w+\s+IF\s+NOT\s+EXISTS\b/;

function readSchemaStatements(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function schemaStatements(dir = SCHEMA_DIR) {
  const statements = SCHEMA_FILES.flatMap((name) => readSchemaStatements(path.join(dir, name)));
  const refused = statements.filter((statement) => !IDEMPOTENT.test(statement));
  if (refused.length) {
    throw new Error(`[NEO4J][SCHEMA] statement is not an idempotent CREATE ... IF NOT EXISTS: ${refused[0].split('\n')[0]}`);
  }
  return statements;
}

async function applyNeo4jSchema(driver, { database = 'neo4j', dir } = {}) {
  const statements = schemaStatements(dir);
  const session = driver.session({ database });
  try {
    for (const statement of statements) {
      await session.run(statement);
    }
  } finally {
    await session.close();
  }
  return { applied: statements.length };
}

module.exports = { SCHEMA_FILES, readSchemaStatements, schemaStatements, applyNeo4jSchema };
