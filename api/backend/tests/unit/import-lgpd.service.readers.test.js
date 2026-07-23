import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { Transform } from 'stream';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importLgpdService = require2('../../src/services/import-lgpd.service');
const ExcelJS = require2('exceljs');

const csvParserPath = require2.resolve('csv-parser');
const importLgpdServicePath = require2.resolve('../../src/services/import-lgpd.service');

const tmpFiles = [];

function writeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `import-lgpd-readers-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  tmpFiles.push(filePath);
  return filePath;
}

async function writeTmpWorkbook(name, sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const { sheetName, rows } of sheets) {
    const worksheet = workbook.addWorksheet(sheetName);
    rows.forEach((row) => worksheet.addRow(row));
  }
  const filePath = path.join(os.tmpdir(), `import-lgpd-readers-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  await workbook.xlsx.writeFile(filePath);
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

describe('ImportLGPDService.readCSV', () => {
  it('rejects when the file does not exist', async () => {
    await expect(importLgpdService.readCSV('/definitely/does/not/exist.csv')).rejects.toThrow('Arquivo não encontrado');
  });

  it('parses a comma-delimited CSV into row objects', async () => {
    const filePath = writeTmpFile('comma.csv', 'patientName,birthDate\nJoão Silva,25/12/1990\nMaria Souza,01/01/2000\n');

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([
      { patientName: 'João Silva', birthDate: '25/12/1990' },
      { patientName: 'Maria Souza', birthDate: '01/01/2000' },
    ]);
  });

  it('auto-detects a semicolon delimiter from the header line', async () => {
    const filePath = writeTmpFile('semicolon.csv', 'patientName;birthDate\nJoão Silva;25/12/1990\n');

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
  });

  it('filters out fully-empty data rows', async () => {
    const filePath = writeTmpFile('blank-row.csv', 'patientName,birthDate\nJoão Silva,25/12/1990\n,\n');

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
  });

  it('rejects a CSV with a header but no data rows', async () => {
    const filePath = writeTmpFile('header-only.csv', 'patientName,birthDate\n');

    await expect(importLgpdService.readCSV(filePath)).rejects.toThrow('Arquivo CSV está vazio ou não contém dados válidos');
  });

  it('wraps a stream error from the underlying csv parser', async () => {
    // csv-parser is required at module scope in import-lgpd.service.js, so
    // the only way to make readCSV's own .pipe(...).on('error', ...) handler
    // fire is to swap the cached csv-parser module for a fake parser that
    // emits 'error', then re-require the service fresh (same require.cache
    // injection pattern used by label.routes.test.js / sample.routes.test.js).
    delete require2.cache[csvParserPath];
    delete require2.cache[importLgpdServicePath];

    require2.cache[csvParserPath] = {
      id: csvParserPath,
      filename: csvParserPath,
      loaded: true,
      exports: () => {
        const t = new Transform({
          transform(chunk, enc, cb) { cb(); },
        });
        process.nextTick(() => t.emit('error', new Error('parse boom')));
        return t;
      },
    };

    try {
      const freshService = require2(importLgpdServicePath);
      const filePath = writeTmpFile('stream-error.csv', 'patientName,birthDate\nJoão Silva,25/12/1990\n');

      await expect(freshService.readCSV(filePath)).rejects.toThrow(
        'Erro ao processar arquivo CSV: parse boom'
      );
    } finally {
      delete require2.cache[csvParserPath];
      delete require2.cache[importLgpdServicePath];
    }
  });
});

describe('ImportLGPDService.readExcel', () => {
  it('rejects when the file does not exist', async () => {
    await expect(importLgpdService.readExcel('/definitely/does/not/exist.xlsx')).rejects.toThrow('Erro ao processar arquivo Excel');
  });

  it('rejects a workbook with no worksheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const filePath = path.join(os.tmpdir(), `import-lgpd-readers-empty-${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    tmpFiles.push(filePath);

    await expect(importLgpdService.readExcel(filePath, 'patients')).rejects.toThrow('Erro ao processar arquivo Excel');
  });

  it('prefers a sheet literally named "Pacientes" for patients data', async () => {
    const filePath = await writeTmpWorkbook('pacientes.xlsx', [
      { sheetName: 'Instruções', rows: [['leia isto antes']] },
      { sheetName: 'Pacientes', rows: [
        ['patientName (*)', 'birthDate'],
        ['João Silva', '25/12/1990'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
  });

  it('falls back to the first non-"Instruções" sheet when there is no "Pacientes" tab', async () => {
    const filePath = await writeTmpWorkbook('fallback.xlsx', [
      { sheetName: 'Instruções', rows: [['leia isto antes']] },
      { sheetName: 'Planilha1', rows: [
        ['patientName', 'birthDate'],
        ['Maria Souza', '01/01/2000'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'Maria Souza', birthDate: '01/01/2000' }]);
  });

  it('prefers a sheet literally named "Amostras" for samples data', async () => {
    const filePath = await writeTmpWorkbook('amostras.xlsx', [
      { sheetName: 'Amostras', rows: [
        ['patientID', 'sampleType'],
        ['12345678', 'PLASMA'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'samples');

    expect(rows).toEqual([{ patientID: '12345678', sampleType: 'PLASMA' }]);
  });

  it('rejects when no header row can be located', async () => {
    const filePath = await writeTmpWorkbook('no-header.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['this is not', 'a recognizable header'],
        ['some', 'data'],
      ] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'patients')).rejects.toThrow(/Não foi possível encontrar a linha de cabeçalhos/);
  });

  it('rejects when there are headers but no data rows', async () => {
    const filePath = await writeTmpWorkbook('no-data.xlsx', [
      { sheetName: 'Pacientes', rows: [['patientName']] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'patients')).rejects.toThrow(/Nenhum dado válido encontrado/);
  });

  it('skips fully-empty rows between header and data', async () => {
    const filePath = await writeTmpWorkbook('empty-rows.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName', 'birthDate'],
        [null, null],
        ['João Silva', '25/12/1990'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
  });

  it('falls back to the first sheet when every sheet is named "Instruções" (patients)', async () => {
    const filePath = await writeTmpWorkbook('all-instrucoes.xlsx', [
      { sheetName: 'Instruções', rows: [
        ['patientName', 'birthDate'],
        ['João Silva', '25/12/1990'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
  });

  it('falls back to the first non-"Instruções" sheet when there is no "Amostras" tab', async () => {
    const filePath = await writeTmpWorkbook('samples-fallback.xlsx', [
      { sheetName: 'Instruções', rows: [['leia isto antes']] },
      { sheetName: 'Planilha1', rows: [
        ['patientID', 'sampleType'],
        ['12345678', 'PLASMA'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'samples');

    expect(rows).toEqual([{ patientID: '12345678', sampleType: 'PLASMA' }]);
  });

  it('falls back to the first sheet when every sheet is named "Instruções" (samples)', async () => {
    const filePath = await writeTmpWorkbook('samples-all-instrucoes.xlsx', [
      { sheetName: 'Instruções', rows: [
        ['patientID', 'sampleType'],
        ['12345678', 'PLASMA'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'samples');

    expect(rows).toEqual([{ patientID: '12345678', sampleType: 'PLASMA' }]);
  });

  it('rejects when dataType is neither "patients" nor "samples" (no sheet gets selected)', async () => {
    const filePath = await writeTmpWorkbook('unknown-datatype.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName', 'birthDate'],
        ['João Silva', '25/12/1990'],
      ] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'unknown')).rejects.toThrow(
      /não encontrada/
    );
  });

  it('reads rich-text cell values via their .text property and serializes Date cells to ISO strings', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pacientes');
    worksheet.addRow(['patientName', 'birthDate']);
    const dataRow = worksheet.addRow([]);
    dataRow.getCell(1).value = { text: 'João Silva', hyperlink: 'https://example.com' };
    dataRow.getCell(2).value = new Date('1990-12-25T00:00:00.000Z');

    const filePath = path.join(os.tmpdir(), `import-lgpd-readers-richtext-${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    tmpFiles.push(filePath);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '1990-12-25T00:00:00.000Z' }]);
  });
});
