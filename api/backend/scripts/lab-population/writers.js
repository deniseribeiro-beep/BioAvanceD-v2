'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPatientsCsv(population) {
  const header = 'patientName,birthDate,sex,email';
  const rows = population.participants.map((p) =>
    [p.patientName, p.birthDate, p.sex, p.email]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

/**
 * Sample CSV for LGPD import after patients exist.
 * participantId is filled at apply-time map; export uses placeholder column
 * participantSourceRecordId for offline joins, plus a companion map file.
 */
function toSamplesCsv(population, participantIdBySource = null) {
  const header = 'participantId,sampleType,sampleOrigin,extractionProtocol,quantity,quality,linkedProject';
  const rows = population.specimens.map((s) => {
    const participantId = participantIdBySource
      ? participantIdBySource[s.participantSourceRecordId] || ''
      : s.participantSourceRecordId;
    return [
      participantId,
      s.sampleType,
      s.sampleOrigin,
      s.extractionProtocol,
      s.quantity,
      s.quality,
      s.linkedProject,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });
  return [header, ...rows].join('\n') + '\n';
}

function toJson(population) {
  return `${JSON.stringify(population, null, 2)}\n`;
}

async function toXlsx(population, outPath, participantIdBySource = null) {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (err) {
    throw new Error(`ExcelJS required for xlsx writer: ${err.message}`);
  }
  const workbook = new ExcelJS.Workbook();
  const patients = workbook.addWorksheet('patients');
  patients.addRow(['patientName', 'birthDate', 'sex', 'email']);
  for (const p of population.participants) {
    patients.addRow([p.patientName, p.birthDate, p.sex, p.email]);
  }
  const samples = workbook.addWorksheet('samples');
  samples.addRow([
    'participantId',
    'sampleType',
    'sampleOrigin',
    'extractionProtocol',
    'quantity',
    'quality',
    'linkedProject',
  ]);
  for (const s of population.specimens) {
    const participantId = participantIdBySource
      ? participantIdBySource[s.participantSourceRecordId] || ''
      : s.participantSourceRecordId;
    samples.addRow([
      participantId,
      s.sampleType,
      s.sampleOrigin,
      s.extractionProtocol,
      s.quantity,
      s.quality,
      s.linkedProject,
    ]);
  }
  await workbook.xlsx.writeFile(outPath);
}

async function writePopulationFormats(population, outDir, formats = ['json', 'csv', 'xlsx']) {
  ensureDir(outDir);
  const written = [];
  if (formats.includes('json')) {
    const p = path.join(outDir, 'population.v1.json');
    fs.writeFileSync(p, toJson(population), 'utf8');
    written.push(p);
  }
  if (formats.includes('csv')) {
    const patientsPath = path.join(outDir, 'patients.csv');
    const samplesPath = path.join(outDir, 'samples.csv');
    fs.writeFileSync(patientsPath, toPatientsCsv(population), 'utf8');
    fs.writeFileSync(samplesPath, toSamplesCsv(population), 'utf8');
    written.push(patientsPath, samplesPath);
  }
  if (formats.includes('xlsx')) {
    const p = path.join(outDir, 'population.xlsx');
    await toXlsx(population, p);
    written.push(p);
  }
  return written;
}

module.exports = {
  toPatientsCsv,
  toSamplesCsv,
  toJson,
  toXlsx,
  writePopulationFormats,
};
