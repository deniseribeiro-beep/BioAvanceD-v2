import { describe, it, expect } from 'vitest';
const { processRecords } = require('../../../src/reference-data/reference-imports/processRecords');
const { normalizeRecord } = require('../../../src/reference-data/reference-imports/normalizeHpo');

function lines(...jsonObjects) {
  return jsonObjects.map((obj, i) => ({ rowNumber: i + 1, line: JSON.stringify(obj) }));
}

describe('processRecords', () => {
  it('builds a concept map and is_a relations from a valid chain', () => {
    const input = lines(
      { id: 'HP:0000001', lbl: 'All', is_a: [] },
      { id: 'HP:0000118', lbl: 'Phenotypic abnormality', is_a: ['HP:0000001'] },
      { id: 'HP:0001250', lbl: 'Seizure', is_a: ['HP:0000118'] },
    );

    const result = processRecords(input, normalizeRecord);

    expect(result.recordsRead).toBe(3);
    expect(result.concepts.size).toBe(3);
    expect(result.concepts.get('HP:0001250')).toMatchObject({ display: 'Seizure' });
    expect(result.relations).toEqual([
      { sourceCode: 'HP:0000118', relationType: 'is_a', targetCode: 'HP:0000001' },
      { sourceCode: 'HP:0001250', relationType: 'is_a', targetCode: 'HP:0000118' },
    ]);
    expect(result.issues).toHaveLength(0);
  });

  it('records an issue and skips invalid JSON lines without throwing', () => {
    const input = [
      { rowNumber: 1, line: '{"id":"HP:0000001","lbl":"All","is_a":[]}' },
      { rowNumber: 2, line: '{not valid json' },
    ];

    const result = processRecords(input, normalizeRecord);

    expect(result.recordsRead).toBe(2);
    expect(result.concepts.size).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ rowNumber: 2, errorCode: 'INVALID_JSON', severity: 'error' });
  });

  it('records MISSING_CODE and MISSING_DISPLAY issues without producing partial concepts', () => {
    const input = lines(
      { id: '', lbl: 'Missing code term', is_a: [] },
      { id: 'HP:9999999', lbl: '', is_a: [] },
    );

    const result = processRecords(input, normalizeRecord);

    expect(result.concepts.size).toBe(0);
    expect(result.issues.map((i) => i.errorCode)).toEqual(['MISSING_CODE', 'MISSING_DISPLAY']);
  });

  it('rejects a relation whose parent was never normalized as an ORPHAN_RELATION issue, not a silent drop (Plano Integrado §7.3)', () => {
    const input = lines({ id: 'HP:0001250', lbl: 'Seizure', is_a: ['HP:0012638'] });

    const result = processRecords(input, normalizeRecord);

    expect(result.concepts.size).toBe(1);
    expect(result.relations).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      entityType: 'TerminologyRelation',
      errorCode: 'ORPHAN_RELATION',
      sourceRecordId: 'HP:0001250>HP:0012638',
      severity: 'error',
    });
  });

  it('processes the full bundled HPO sample fixture end to end', async () => {
    const fs = require('fs');
    const path = require('path');
    const readline = require('readline');
    const fixturePath = path.join(__dirname, '../../../src/reference-data/reference-imports/fixtures/hpo-sample.jsonl');

    const rl = readline.createInterface({ input: fs.createReadStream(fixturePath), crlfDelay: Infinity });
    const rawLines = [];
    let rowNumber = 0;
    for await (const line of rl) {
      rowNumber += 1;
      if (line.trim()) rawLines.push({ rowNumber, line: line.trim() });
    }

    const result = processRecords(rawLines, normalizeRecord);

    expect(result.recordsRead).toBe(10);
    expect(result.concepts.size).toBe(8);
    expect(result.relations).toHaveLength(7); // every concept but the root has an is_a edge
    expect(result.issues.map((i) => i.errorCode)).toEqual(['MISSING_CODE', 'MISSING_DISPLAY']);
  });
});
