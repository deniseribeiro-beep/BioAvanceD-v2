const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSigtapLine, convertFile } = require('../../src/reference-data/reference-imports/lab/convertSigtapTabelaToJsonl');

describe('parseSigtapLine', () => {
  it('parses fixed-width CO_PROCEDIMENTO + NO_PROCEDIMENTO', () => {
    const line = `${'0101010010'}${'ATIVIDADE EDUCATIVA / ORIENTAÇÃO EM GRUPO NA ATENÇÃO PRIMÁRIA'.padEnd(250, ' ')}`;
    expect(parseSigtapLine(line)).toEqual({
      id: '0101010010',
      lbl: 'ATIVIDADE EDUCATIVA / ORIENTAÇÃO EM GRUPO NA ATENÇÃO PRIMÁRIA',
      is_a: [],
      synonyms: [],
      obsolete: false,
    });
  });

  it('rejects short or non-numeric codes', () => {
    expect(parseSigtapLine('123')).toBeNull();
    expect(parseSigtapLine('ABCDEFGHIJNOME')).toBeNull();
  });
});

describe('convertFile', () => {
  it('writes JSONL from a one-line fixed-width fixture', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigtap-conv-'));
    const inPath = path.join(dir, 'tb_procedimento.txt');
    const outPath = path.join(dir, 'out.jsonl');
    const line = `${'0101010010'}${'ATIVIDADE EDUCATIVA'.padEnd(250, ' ')}`;
    fs.writeFileSync(inPath, `${line}\n`, { encoding: 'latin1' });
    const written = await convertFile(inPath, outPath, null);
    expect(written).toBe(1);
    const jsonl = fs.readFileSync(outPath, 'utf8').trim();
    expect(JSON.parse(jsonl)).toMatchObject({ id: '0101010010', lbl: 'ATIVIDADE EDUCATIVA' });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
