const fs = require('fs');
const os = require('os');
const path = require('path');
const { importFile, SYSTEM_URI } = require('../../scripts/reference-imports/import-sigtap-procedures');

describe('import-sigtap-procedures importFile', () => {
  it('dry-run counts valid JSONL rows without MongoDB', async () => {
    const fixture = path.join(
      __dirname,
      '../../src/reference-data/reference-imports/fixtures/sigtap-procedures-sample.jsonl',
    );
    const result = await importFile(null, fixture, true);
    expect(result.systemUri).toBe(SYSTEM_URI);
    expect(result.dryRun).toBe(true);
    expect(result.upserted).toBeGreaterThan(100);
    expect(result.rejected).toBe(0);
  });

  it('rejects lines missing code or display', async () => {
    const tmp = path.join(os.tmpdir(), `sigtap-import-test-${Date.now()}.jsonl`);
    fs.writeFileSync(
      tmp,
      [
        JSON.stringify({ id: '0101010010', lbl: 'OK' }),
        JSON.stringify({ id: '', lbl: 'Sem código' }),
        JSON.stringify({ id: '1234567890', lbl: '' }),
      ].join('\n'),
      'utf8',
    );
    try {
      const result = await importFile(null, tmp, true);
      expect(result.upserted).toBe(1);
      expect(result.rejected).toBe(2);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});