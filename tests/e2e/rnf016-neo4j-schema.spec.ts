import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { readSchemaCatalog, closeNeo4jDriver } from './helpers/queryNeo4j';

// #1557 (RNF016 C7): the projection worker applies the declared Neo4j schema
// before its first lease, so on the running stack every constraint and index
// that 001_iso20387_constraints_indexes.cypher declares is in the database.
// The file is parsed with the same patterns as
// api/backend/tests/architecture/neo4j-schema-constraints.arch.test.js, and
// each declaration is matched by name, label and keys. The `type` column is
// not compared: its values changed across Neo4j 5 minors.

const FILE = path.resolve(__dirname, '../../api/backend/src/infrastructure/database/neo4j/schema/001_iso20387_constraints_indexes.cypher');
const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const CONSTRAINT = /CREATE CONSTRAINT (\w+) IF NOT EXISTS\s+FOR \((\w+):(\w+)\)\s+REQUIRE (\(([^)]*)\)|\w+\.\w+) IS UNIQUE;/g;
const INDEX = /CREATE INDEX (\w+) IF NOT EXISTS\s+FOR \((\w+):(\w+)\)\s+ON \((\w+)\.(\w+)\);/g;
const keyList = (keys: string) => keys.split(',').map((part) => part.trim().split('.')[1]).sort();
const constraints = [...text.matchAll(CONSTRAINT)].map((m) => ({
  name: m[1],
  label: m[3],
  keys: keyList(m[5] !== undefined ? m[5] : m[4]),
}));
const indexes = [...text.matchAll(INDEX)].map((m) => ({ name: m[1], label: m[3], property: m[5] }));

test.afterAll(closeNeo4jDriver);

test('RNF016 C7 (#1557): every declared constraint is in the database', async () => {
  expect(constraints).toHaveLength((text.match(/CREATE CONSTRAINT/g) || []).length);
  const { constraints: rows } = await readSchemaCatalog();
  for (const declared of constraints) {
    const row = rows.find((r) => r.name === declared.name);
    expect(row, declared.name).toBeTruthy();
    expect(row!.labelsOrTypes, declared.name).toEqual([declared.label]);
    expect([...row!.properties].sort(), declared.name).toEqual(declared.keys);
  }
});

test('RNF016 C7 (#1557): every declared index is in the database', async () => {
  expect(indexes).toHaveLength((text.match(/CREATE INDEX/g) || []).length);
  const { indexes: rows } = await readSchemaCatalog();
  for (const declared of indexes) {
    const row = rows.find((r) => r.name === declared.name);
    expect(row, declared.name).toBeTruthy();
    expect(row!.labelsOrTypes, declared.name).toEqual([declared.label]);
    expect(row!.properties, declared.name).toEqual([declared.property]);
  }
});
