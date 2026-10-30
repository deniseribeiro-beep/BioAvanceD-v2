import { describe, it, expect, afterEach, vi } from 'vitest';
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

  // #1175: .pipe() does not forward the SOURCE stream's 'error', so a read
  // failure after the existence check and separator sniff (the file removed
  // in between) was an uncaught exception instead of a rejection.
  it('rejects when the read stream fails after the existence check (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `import-lgpd-readers-missing-${Date.now()}.csv`);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(Buffer.from('a,b\n1,2\n'));

    await expect(importLgpdService.readCSV(missingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    existsSpy.mockRestore();
    readSpy.mockRestore();
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

  // #1001: readCSV drops blank rows silently before this array is even
  // returned, so a caller (importPatients/importSamples/importPatientsSmart)
  // that only counts inside its own row loop can never see them. The reader
  // itself now reports what it discarded via a non-enumerable `skippedCount`
  // on the returned array -- non-enumerable so it doesn't disturb the
  // `toEqual` shape the tests above assert.
  it('#1001: reports the number of hasData-rejected rows via a non-enumerable skippedCount', async () => {
    const filePath = writeTmpFile(
      'skipped-count.csv',
      'patientName,birthDate\nJoão Silva,25/12/1990\n,\n,\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
    expect(rows.skippedCount).toBe(2);
    // Non-enumerable: does not show up in a plain deep-equality/ownKeys walk.
    expect(Object.keys(rows)).not.toContain('skippedCount');
  });

  it('#1001: reports skippedCount 0 when there are no blank rows to discard', async () => {
    const filePath = writeTmpFile('no-blanks.csv', 'patientName,birthDate\nJoão Silva,25/12/1990\n');

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows.skippedCount).toBe(0);
  });

  // #1012: pins the behaviour the removed comment wrongly credited to
  // `skipEmptyLines`/`skipLinesWithError` (neither is a real csv-parser
  // option) -- bare blank physical lines, not comma-only rows, still get
  // counted correctly because they reach the handler's own `hasData` check.
  it('#1012: counts bare trailing blank lines (LF) via hasData, not a parser option', async () => {
    const filePath = writeTmpFile(
      'bare-blank-lines-lf.csv',
      'patientName,birthDate\nJoão Silva,25/12/1990\n\n\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
    expect(rows.skippedCount).toBe(2);
  });

  // #1012: CRLF twin of the case above.
  it('#1012: counts bare trailing blank lines (CRLF) via hasData, not a parser option', async () => {
    const filePath = writeTmpFile(
      'bare-blank-lines-crlf.csv',
      'patientName,birthDate\r\nJoão Silva,25/12/1990\r\n\r\n\r\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
    expect(rows.skippedCount).toBe(2);
  });

  // #1012: control -- a single, normal trailing newline is not itself a
  // blank line and must not be counted. This is what separates a real
  // result from a broken fixture in the two cases above.
  it('#1012: does not count a single ordinary trailing newline as a blank line', async () => {
    const filePath = writeTmpFile(
      'single-trailing-newline.csv',
      'patientName,birthDate\nJoão Silva,25/12/1990\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
    expect(rows.skippedCount).toBe(0);
  });

  // Every blank-row fixture above puts the blank row at the END of the
  // file, which is exactly the case where reporting "post-filter array
  // index + 2" instead of the true physical source line is invisible: the
  // blank row is discarded, but there is no later row for the missing index
  // to shift. A blank row in the MIDDLE shifts every later row's physical
  // line by one relative to its position in the filtered `rows` array --
  // `sourceLines` is the reader's report of the true physical line for each
  // row it keeps, and must reflect that shift.
  it('reports the physical source line per row (not the post-filter array index) when a blank row sits in the middle', async () => {
    const filePath = writeTmpFile(
      'mid-blank-row.csv',
      'patientName,birthDate\nJoão Silva,25/12/1990\n,\nMaria Souza,01/01/2000\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([
      { patientName: 'João Silva', birthDate: '25/12/1990' },
      { patientName: 'Maria Souza', birthDate: '01/01/2000' },
    ]);
    // Physical lines: 1=header, 2=João, 3=blank (discarded), 4=Maria.
    // array-index+2 would wrongly report [2, 3] for the second row.
    expect(rows.sourceLines).toEqual([2, 4]);
    // Non-enumerable, same rationale as skippedCount above.
    expect(Object.keys(rows)).not.toContain('sourceLines');
  });

  // #1035: a record with a quoted embedded newline spans multiple physical
  // lines but is still a single csv-parser 'data' event. The record itself
  // (patientName "multi\nline") occupies physical lines 3-4 and is correctly
  // reported at its start line, 3 -- the assertion that actually pins the
  // fix is the record AFTER it: Maria Souza is truly on physical line 5, but
  // the old per-event counter (one increment per 'data' event, regardless of
  // how many physical lines that event consumed) reports 4 there.
  it('#1035: reports the true physical line for a record after one with a quoted embedded newline', async () => {
    const filePath = writeTmpFile(
      'embedded-newline.csv',
      'patientName,birthDate,notes\nJoão Silva,25/12/1990,ok\n"multi\nline",01/01/2000,notes2\nMaria Souza,02/02/2000,ok3\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([
      { patientName: 'João Silva', birthDate: '25/12/1990', notes: 'ok' },
      { patientName: 'multi\nline', birthDate: '01/01/2000', notes: 'notes2' },
      { patientName: 'Maria Souza', birthDate: '02/02/2000', notes: 'ok3' },
    ]);
    // Physical lines: 1=header, 2=João, 3-4=quoted record (starts at 3),
    // 5=Maria. The old per-event counter reports [2, 3, 4] here.
    expect(rows.sourceLines).toEqual([2, 3, 5]);
  });

  // Control twin of the case above: same row count and shape, but no
  // embedded newline anywhere, so every record occupies exactly one
  // physical line. Numbers here must be identical before and after #1035 --
  // this is what separates a real fix from a broken fixture in the case
  // above.
  it('#1035: control -- physical line numbers are unchanged when no record spans multiple lines', async () => {
    const filePath = writeTmpFile(
      'no-embedded-newline.csv',
      'patientName,birthDate,notes\nJoão Silva,25/12/1990,ok\nPedro Costa,03/03/1985,ok2\nMaria Souza,02/02/2000,ok3\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([
      { patientName: 'João Silva', birthDate: '25/12/1990', notes: 'ok' },
      { patientName: 'Pedro Costa', birthDate: '03/03/1985', notes: 'ok2' },
      { patientName: 'Maria Souza', birthDate: '02/02/2000', notes: 'ok3' },
    ]);
    expect(rows.sourceLines).toEqual([2, 3, 4]);
  });

  // #1035: multi-byte UTF-8 (accented Portuguese) before later records. The
  // reader now derives physical lines from BYTE offsets over a Buffer
  // (fileBuffer), not from JS string/character positions -- a char-index
  // mistake would undercount here, because each accented character below is
  // 2 bytes in UTF-8 but 1 UTF-16 code unit in a JS string. Verified by hand
  // (Buffer.byteLength arithmetic): a char-offset-based newline table would
  // misreport the row after the accented one as line 4 (not 3) and the row
  // after that as line 5 (not 4).
  it('#1035: reports the true physical line for records after one with multi-byte UTF-8 fields', async () => {
    const filePath = writeTmpFile(
      'multibyte-utf8.csv',
      'patientName,birthDate,notes\náéíóúÁÉÍÓÚãõÃÕçÇâêîôûÂÊÎÔÛàèìòù,25/12/1990,acentuado\nx,1,y\nMaria Souza,02/02/2000,ok3\n'
    );

    const rows = await importLgpdService.readCSV(filePath);

    expect(rows).toEqual([
      { patientName: 'áéíóúÁÉÍÓÚãõÃÕçÇâêîôûÂÊÎÔÛàèìòù', birthDate: '25/12/1990', notes: 'acentuado' },
      { patientName: 'x', birthDate: '1', notes: 'y' },
      { patientName: 'Maria Souza', birthDate: '02/02/2000', notes: 'ok3' },
    ]);
    expect(rows.sourceLines).toEqual([2, 3, 4]);
  });

  it('rejects a CSV with a header but no data rows', async () => {
    const filePath = writeTmpFile('header-only.csv', 'patientName,birthDate\n');

    await expect(importLgpdService.readCSV(filePath)).rejects.toThrow('Arquivo CSV está vazio ou não contém dados válidos');
  });

  it('rejects a CSV whose every line is blank, sniffing no delimiter (#1337)', async () => {
    const filePath = writeTmpFile('all-blank.csv', '\n   \n\n');

    await expect(importLgpdService.readCSV(filePath)).rejects.toThrow('Arquivo CSV está vazio ou não contém dados válidos');
  });

  it('wraps a csv parser error that carries no message with the default text (#1337)', async () => {
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
        process.nextTick(() => t.emit('error', new Error('')));
        return t;
      },
    };

    try {
      const freshService = require2(importLgpdServicePath);
      const filePath = writeTmpFile('stream-error-no-message.csv', 'patientName,birthDate\nJoão Silva,25/12/1990\n');

      await expect(freshService.readCSV(filePath)).rejects.toThrow(
        'Erro ao processar arquivo CSV: Erro desconhecido'
      );
    } finally {
      delete require2.cache[csvParserPath];
      delete require2.cache[importLgpdServicePath];
    }
  });

  it('wraps a stream error from the underlying csv parser', async () => {
    // csv-parser is required at module scope in import-lgpd.service.js, so
    // the only way to make readCSV's own .pipe(...).on('error', ...) handler
    // fire is to swap the cached csv-parser module for a fake parser that
    // emits 'error', then re-require the service fresh (same require.cache
    // injection pattern used by sample.routes.test.js).
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

  it('names patientName as the missing header for a patients sheet (#1337)', async () => {
    const filePath = await writeTmpWorkbook('no-header-patients.xlsx', [
      { sheetName: 'Pacientes', rows: [['nome', 'nascimento'], ['João', '25/12/1990']] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'patients')).rejects.toThrow('a coluna "patientName" está presente');
  });

  it('names participantId or sampleType as the missing header for a samples sheet (#1337)', async () => {
    const filePath = await writeTmpWorkbook('no-header-samples.xlsx', [
      { sheetName: 'Amostras', rows: [['codigo', 'tipo'], ['1', 'PLASMA']] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'samples')).rejects.toThrow('a coluna "participantId ou sampleType" está presente');
  });

  it('rejects a sheet with no rows at all (#1337)', async () => {
    const filePath = await writeTmpWorkbook('empty-sheet.xlsx', [
      { sheetName: 'Pacientes', rows: [] },
    ]);

    await expect(importLgpdService.readExcel(filePath, 'patients')).rejects.toThrow('Erro ao processar arquivo Excel: Planilha está vazia');
  });

  it('skips a row whose only values sit outside the header columns, and counts it (#1337)', async () => {
    const filePath = await writeTmpWorkbook('stray-cell.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName'],
        ['João Silva'],
        [null, 'stray'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva' }]);
    expect(rows.skippedCount).toBe(1);
  });

  it('wraps a thrown value with no message in the default text (#1337)', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementationOnce(() => { throw 'disk gone'; });

    await expect(importLgpdService.readExcel('/any/file.xlsx', 'patients')).rejects.toThrow(
      'Erro ao processar arquivo Excel: Erro desconhecido'
    );
    existsSpy.mockRestore();
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

  // #1001: mirrors readCSV's skippedCount above, but for readExcel's two
  // discard sites (:391-392 raw-cell isEmpty, :404-407 all-values-null after
  // header mapping). Two blank rows here are both raw-empty, so they are
  // caught by the first check -- the "no double-count" guarantee is that the
  // count is exactly 2 (rows), not 4 (rows x two checks).
  it('#1001: reports the number of blank rows discarded via a non-enumerable skippedCount, without double-counting', async () => {
    const filePath = await writeTmpWorkbook('skipped-count.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName', 'birthDate'],
        [null, null],
        ['João Silva', '25/12/1990'],
        [null, null],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([{ patientName: 'João Silva', birthDate: '25/12/1990' }]);
    expect(rows.skippedCount).toBe(2);
    expect(Object.keys(rows)).not.toContain('skippedCount');
  });

  it('#1001: reports skippedCount 0 when there are no blank rows to discard', async () => {
    const filePath = await writeTmpWorkbook('no-blanks.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName', 'birthDate'],
        ['João Silva', '25/12/1990'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows.skippedCount).toBe(0);
  });

  // xlsx twin of the CSV mid-file blank-row case above: every existing
  // blank-row fixture puts the blank row at the END, where the bug is
  // invisible. `sourceLines` must report the true Excel row number per kept
  // row, not header-index + 1 over the post-filter `dataRows` array.
  it('reports the physical Excel row number per row (not the post-filter array index) when a blank row sits in the middle', async () => {
    const filePath = await writeTmpWorkbook('mid-blank-row.xlsx', [
      { sheetName: 'Pacientes', rows: [
        ['patientName', 'birthDate'],
        ['João Silva', '25/12/1990'],
        [null, null],
        ['Maria Souza', '01/01/2000'],
      ] },
    ]);

    const rows = await importLgpdService.readExcel(filePath, 'patients');

    expect(rows).toEqual([
      { patientName: 'João Silva', birthDate: '25/12/1990' },
      { patientName: 'Maria Souza', birthDate: '01/01/2000' },
    ]);
    // Excel rows: 1=header, 2=João, 3=blank (discarded), 4=Maria.
    // header-index+1 over dataRows would wrongly report [2, 3] for row 2.
    expect(rows.sourceLines).toEqual([2, 4]);
    expect(Object.keys(rows)).not.toContain('sourceLines');
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
