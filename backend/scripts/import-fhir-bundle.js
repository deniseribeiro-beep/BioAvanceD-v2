// Script ETL: Parser de FHIR Bundle para JSON limpo
// Uso: node import-fhir-bundle.js <caminho_para_bundle.json>

const fs = require('fs');
const path = require('path');

function mapDiagnoses(conditions) {
  // Exemplo: mapeamento CID/ORPHA/OMIM (ajuste conforme necessário)
  return conditions.map(cond => ({
    cid: cond.code?.coding?.find(c => c.system?.includes('icd'))?.code || null,
    orpha: cond.code?.coding?.find(c => c.system?.includes('orpha'))?.code || null,
    omim: cond.code?.coding?.find(c => c.system?.includes('omim'))?.code || null,
  }));
}

function extractPatient(bundle) {
  const patient = bundle.entry.find(e => e.resource.resourceType === 'Patient')?.resource;
  if (!patient) return null;
  const identifier = patient.identifier?.[0]?.value || null;
  return {
    id: identifier,
    name: patient.name?.[0]?.text || null,
    gender: patient.gender || null,
    birthDate: patient.birthDate || null,
  };
}

function extractConditions(bundle) {
  return bundle.entry
    .filter(e => e.resource.resourceType === 'Condition')
    .map(e => e.resource);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node import-fhir-bundle.js <caminho_para_bundle.json>');
    process.exit(1);
  }
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const patient = extractPatient(bundle);
  const conditions = extractConditions(bundle);
  const diagnoses = mapDiagnoses(conditions);
  const output = {
    patient: patient ? { ...patient, diagnoses } : null,
    tcle: null, // Carga parcial permitida
    samples: [], // Carga parcial permitida
  };
  const outPath = path.basename(file, '.json') + '.import.json';
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Arquivo de importação gerado:', outPath);
}

if (require.main === module) main();
