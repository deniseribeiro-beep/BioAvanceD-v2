#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

const activeFiles = new Set([
  path.join(root, 'api/backend/src/routes/intakeWizard.js'),
  path.join(root, 'api/backend/src/controllers/import.controller.js'),
  path.join(root, 'api/backend/src/controllers/import-lgpd.controller.js'),
  path.join(root, 'api/backend/src/controllers/paciente.controller.js'),
  path.join(root, 'api/backend/src/services/SampleGraphValidator.js'),
  path.join(root, 'api/backend/src/services/batch-validation-engine.service.js'),
  path.join(root, 'api/backend/src/services/analysisValidation.service.js'),
  path.join(root, 'api/backend/src/services/storageService.js'),
  path.join(root, 'api/backend/src/services/hl7.service.js'),
  path.join(root, 'api/backend/src/services/securityAlerts.service.js'),
  path.join(root, 'api/backend/src/services/temperature.service.js'),
  path.join(root, 'api/backend/src/services/sampleComplianceSync.service.js'),
  path.join(root, 'frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx'),
  path.join(root, 'frontend/src/views/SampleDetailsPage.tsx'),
]);

const replacements = [
  ['patientID', 'participantId'],
  ['patientId', 'participantId'],
  ['pseudoId', 'participantId'],
  ['mongoPatientId', 'participantObjectId'],
  ['sampleID', 'specimenId'],
  ['sampleId', 'specimenId'],
  ['specimenID', 'specimenId'],
  ['mongoSampleId', 'specimenObjectId'],
  ['parentSampleId', 'parentSpecimenId'],
  ['registerDate', 'registeredAt'],
  ['registrationDate', 'registeredAt'],
  ['withdrawalDate', 'withdrawnAt'],
  ['receivedTime', 'receivedAt'],
  ['currentStatus', 'lifecycleStatus'],
  ['tcle_id', 'consentTemplateId'],
  ['tcle_template_id', 'consentTemplateId'],
  ['selected_tcle', 'consentTemplateId'],
  ['merkle_root', 'merkleRoot'],
  ['clinical_data', 'clinicalData'],
  ['pharmacology_data', 'pharmacologyData'],
  ['biomarkers_values', 'biomarkerValues'],
  ['treatment_status', 'treatmentStatus'],
  ['drug_name', 'medicationName'],
  ['medication_name', 'medicationName'],
  ['medication_code', 'atcCode'],
  ['atc_code', 'atcCode'],
  ['medication_drug_class', 'atcClass'],
  ['atc_level_1', 'atcClass'],
  ['last_dose_date', 'lastDoseDate'],
  ['washout_start_date', 'washoutStartDate'],
  ['washout_end_date', 'washoutEndDate'],
];

const removeProps = ['quality_score', 'quality_category', 'penalty_log', 'legacy_compat'];

const target = process.argv[2];

function processFile(filePath) {
  if (!activeFiles.has(filePath)) return { skipped: true };
  let source = fs.readFileSync(filePath, 'utf8');
  const original = source;
  for (const [from, to] of replacements) {
    source = source.split(from).join(to);
  }
  for (const prop of removeProps) {
    source = source.replace(new RegExp(`\\b${prop}\\b`, 'g'), '');
  }
  if (source !== original) {
    fs.writeFileSync(filePath, source, 'utf8');
    return { changed: true };
  }
  return { changed: false };
}

if (!target) {
  console.log('Usage: node scripts/codemods/canonical-field-rename.js <file>');
  console.log('Allowed files:');
  for (const file of activeFiles) console.log(path.relative(root, file));
  process.exit(0);
}

const filePath = path.resolve(root, target);
const result = processFile(filePath);
console.log(JSON.stringify({ file: target, ...result }, null, 2));
