const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JSONL_FILES = [
  'orphanet_entities.jsonl',
  'cids_projection.jsonl',
  'terminology_mappings.jsonl',
  'orphanet_classifications.jsonl',
  'terminologies_orpha.jsonl',
];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function artifactFile(artifact, relativePath) {
  return path.join(artifact, ...String(relativePath).split(/[\\/]/));
}

async function checksumFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath, errors, label) {
  const rows = [];
  const text = await fs.promises.readFile(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      errors.push(`${label}:${index + 1} invalid JSON: ${error.message}`);
    }
  });
  return rows;
}

function requireFile(filePath, label, errors) {
  if (!fs.existsSync(filePath)) errors.push(`Missing file: ${label}`);
}

function addDuplicateErrors(rows, keyFn, label, errors) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (!key) return;
    if (seen.has(key)) errors.push(`Duplicate ${label}: ${key} at row ${index + 1}`);
    seen.add(key);
  });
}

function required(row, fields, label, errors) {
  fields.forEach((field) => {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      errors.push(`${label} missing ${field}`);
    }
  });
}

function canonicalCode(row = {}) {
  return String(row.canonicalCode || row.sourceCanonicalCode || row.orphaCode || row.code || '')
    .replace(/^ORPHA:/i, '')
    .trim();
}

function scanNoHpoOrBiomarker(row, label, errors) {
  const codeFields = [
    row.code,
    row.canonicalCode,
    row.sourceCode,
    row.sourceCanonicalCode,
    row.targetCode,
    row.orphaCode,
  ].filter(Boolean).map(String);
  if (codeFields.some((value) => /^HP:/i.test(value))) {
    errors.push(`${label} contains HPO code in ORPHA seed`);
  }

  const systemFields = [
    row.system,
    row.sourceSystem,
    row.targetSystem,
    row.domain,
  ].filter(Boolean).map(String);
  if (systemFields.some((value) => /HPO|BIOMARKER|BIOMARCADOR/i.test(value))) {
    errors.push(`${label} contains HPO or biomarker system in ORPHA seed`);
  }
}

function validateEntity(row, index, errors) {
  const label = `orphanet_entities row ${index + 1}`;
  required(row, ['system', 'code', 'canonicalCode', 'domain', 'labels', 'synonyms', 'definitions', 'source', 'release', 'active'], label, errors);
  if (row.system !== 'ORPHA') errors.push(`${label} system must be ORPHA`);
  if (!/^ORPHA:\d+$/.test(String(row.code || ''))) errors.push(`${label} code must be ORPHA:<codigo>`);
  if (!/^\d+$/.test(canonicalCode(row))) errors.push(`${label} canonicalCode must be numeric`);
  if (row.domain !== 'rare_disease') errors.push(`${label} domain must be rare_disease`);
  if (!row.labels?.pt && !row.labels?.en) errors.push(`${label} must have pt or en label`);
  scanNoHpoOrBiomarker(row, label, errors);
}

function validateTerminology(row, index, errors) {
  const label = `terminologies_orpha row ${index + 1}`;
  required(row, ['system', 'code', 'canonicalCode', 'label', 'labels', 'domain', 'source', 'release', 'active'], label, errors);
  if (row.system !== 'ORPHA') errors.push(`${label} system must be ORPHA`);
  if (row.domain !== 'rare_disease') errors.push(`${label} domain must be rare_disease`);
  scanNoHpoOrBiomarker(row, label, errors);
}

function validateMapping(row, index, entityUniverse, errors) {
  const label = `terminology_mappings row ${index + 1}`;
  required(row, ['sourceSystem', 'sourceCode', 'sourceCanonicalCode', 'targetSystem', 'targetCode', 'relationType', 'source', 'active'], label, errors);
  if (row.sourceSystem !== 'ORPHA') errors.push(`${label} sourceSystem must be ORPHA`);
  if (!['ICD10', 'ICD11', 'SNOMED_CT', 'OMIM'].includes(row.targetSystem)) {
    errors.push(`${label} invalid targetSystem: ${row.targetSystem}`);
  }
  if (!entityUniverse.has(canonicalCode(row))) {
    errors.push(`${label} sourceCanonicalCode not present in ORPHA PT/EN universe: ${canonicalCode(row)}`);
  }
  scanNoHpoOrBiomarker(row, label, errors);
}

async function writeValidationReport(artifact, report) {
  const filePath = artifactFile(artifact, 'validation/validation_report.json');
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const artifact = path.resolve(args.artifact || './artifacts/orphanet-2025-07-initial-seed');
  const errors = [];
  const warnings = [];

  requireFile(artifactFile(artifact, 'manifest.json'), 'manifest.json', errors);
  requireFile(artifactFile(artifact, 'validation/source_counts.json'), 'validation/source_counts.json', errors);
  requireFile(artifactFile(artifact, 'validation/normalized_counts.json'), 'validation/normalized_counts.json', errors);
  requireFile(artifactFile(artifact, 'validation/checksums.json'), 'validation/checksums.json', errors);
  JSONL_FILES.forEach((fileName) => requireFile(artifactFile(artifact, `normalized/${fileName}`), `normalized/${fileName}`, errors));

  if (errors.length) {
    await writeValidationReport(artifact, {
      status: 'FAIL',
      generatedAt: new Date().toISOString(),
      errors,
      warnings,
    });
    throw new Error(errors.join('\n'));
  }

  const manifest = await readJson(artifactFile(artifact, 'manifest.json'));
  const sourceCounts = await readJson(artifactFile(artifact, 'validation/source_counts.json'));
  const normalizedCounts = await readJson(artifactFile(artifact, 'validation/normalized_counts.json'));
  const checksums = await readJson(artifactFile(artifact, 'validation/checksums.json'));

  const requiredSources = [
    ['ptZip', 'ZIP PT'],
    ['enZip', 'ZIP EN'],
    ['snomedXlsx', 'XLSX SNOMED'],
  ];
  for (const [key, label] of requiredSources) {
    const source = checksums.sources?.[key] || sourceCounts.sources?.[key];
    if (!source?.path) {
      errors.push(`Missing source checksum metadata for ${label}`);
      continue;
    }
    if (!fs.existsSync(source.path)) {
      errors.push(`${label} not found at ${source.path}`);
      continue;
    }
    const actual = await checksumFile(source.path);
    if (actual !== source.sha256) errors.push(`${label} SHA256 mismatch`);
  }

  for (const [relative, expected] of Object.entries(checksums.artifacts || {})) {
    const filePath = artifactFile(artifact, relative);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing checksum target: ${relative}`);
      continue;
    }
    const actual = await checksumFile(filePath);
    if (actual !== expected) errors.push(`Checksum mismatch: ${relative}`);
  }

  const data = {};
  for (const fileName of JSONL_FILES) {
    data[fileName] = await readJsonl(artifactFile(artifact, `normalized/${fileName}`), errors, fileName);
  }

  for (const fileName of JSONL_FILES) {
    const key = fileName.replace(/\.jsonl$/, '');
    if (normalizedCounts[key] !== data[fileName].length) {
      errors.push(`normalized_counts mismatch for ${key}: expected ${normalizedCounts[key]}, actual ${data[fileName].length}`);
    }
    if (manifest.normalizedCounts?.[key] !== undefined && manifest.normalizedCounts[key] !== data[fileName].length) {
      errors.push(`manifest count mismatch for ${key}: expected ${manifest.normalizedCounts[key]}, actual ${data[fileName].length}`);
    }
  }

  const entities = data['orphanet_entities.jsonl'];
  const terminologies = data['terminologies_orpha.jsonl'];
  const mappings = data['terminology_mappings.jsonl'];
  const cids = data['cids_projection.jsonl'];

  entities.forEach((row, index) => validateEntity(row, index, errors));
  terminologies.forEach((row, index) => validateTerminology(row, index, errors));
  const entityUniverse = new Set(entities.map(canonicalCode).filter(Boolean));
  mappings.forEach((row, index) => validateMapping(row, index, entityUniverse, errors));
  cids.forEach((row, index) => {
    const label = `cids_projection row ${index + 1}`;
    required(row, ['orphaCode', 'code', 'system', 'label', 'labels', 'icd10Codes', 'icd11Codes', 'snomedCtCodes', 'omimCodes', 'source', 'release', 'active'], label, errors);
    if (row.system !== 'ORPHA') errors.push(`${label} system must be ORPHA`);
    scanNoHpoOrBiomarker(row, label, errors);
  });

  addDuplicateErrors(entities, (row) => canonicalCode(row), 'canonical ORPHA entity', errors);
  addDuplicateErrors(terminologies, (row) => canonicalCode(row), 'ORPHA terminology', errors);
  addDuplicateErrors(mappings, (row) => `${row.sourceSystem}:${row.sourceCode}:${row.targetSystem}:${row.targetCode}`, 'mapping', errors);

  const ptCount = Number(sourceCounts?.packs?.pt?.distinctOrphaCodes || 0);
  const enCount = Number(sourceCounts?.packs?.en?.distinctOrphaCodes || 0);
  const unionCount = Number(sourceCounts?.unionDistinctOrphaCodes || 0);
  if (!ptCount) errors.push('ORPHA PT count is zero');
  if (!enCount) errors.push('ORPHA EN count is zero');
  if (!unionCount) errors.push('ORPHA PT+EN union count is zero');
  if (unionCount !== entityUniverse.size) errors.push(`ORPHA union mismatch: source=${unionCount}, entities=${entityUniverse.size}`);

  const mappingCounts = {
    icd10Mappings: mappings.filter((row) => row.targetSystem === 'ICD10').length,
    icd11Mappings: mappings.filter((row) => row.targetSystem === 'ICD11').length,
    snomedCtMappings: mappings.filter((row) => row.targetSystem === 'SNOMED_CT').length,
    omimMappings: mappings.filter((row) => row.targetSystem === 'OMIM').length,
  };
  if (!mappingCounts.icd10Mappings) errors.push('ICD10 mappings must be > 0');
  if (!mappingCounts.icd11Mappings) errors.push('ICD11 mappings must be > 0');
  if (sourceCounts.snomed?.rowsExtracted && !mappingCounts.snomedCtMappings) {
    errors.push('SNOMED-CT mappings expected from XLSX but none were normalized');
  }
  if (!mappingCounts.snomedCtMappings) errors.push('SNOMED_CT mappings must be > 0');

  const snomedUnknown = mappings
    .filter((row) => row.targetSystem === 'SNOMED_CT' && !entityUniverse.has(canonicalCode(row)))
    .map((row) => canonicalCode(row));
  if (snomedUnknown.length) {
    errors.push(`SNOMED ORPHA codes missing from PT/EN universe: ${Array.from(new Set(snomedUnknown)).slice(0, 20).join(', ')}`);
  }

  const omimMappings = mappings.filter((row) => row.targetSystem === 'OMIM');
  const omimEnrichment = (manifest.enrichments || []).find((item) => item.name === 'OMIM');
  if (omimEnrichment && !omimMappings.length) {
    errors.push('OMIM enrichment was executed but OMIM mappings count is zero');
  }
  omimMappings.forEach((row, index) => {
    const label = `OMIM mapping row ${index + 1}`;
    if (row.sourceSystem !== 'ORPHA') errors.push(`${label} sourceSystem must be ORPHA`);
    if (!row.sourceCanonicalCode) errors.push(`${label} missing sourceCanonicalCode`);
    if (!entityUniverse.has(canonicalCode(row))) errors.push(`${label} sourceCanonicalCode not present in seed universe: ${canonicalCode(row)}`);
    if (row.targetSystem !== 'OMIM') errors.push(`${label} targetSystem must be OMIM`);
  });
  addDuplicateErrors(omimMappings, (row) => `${row.sourceSystem}:${row.sourceCode}:${row.targetCode}`, 'ORPHA-OMIM mapping', errors);

  const report = {
    status: errors.length ? 'FAIL' : 'PASS',
    generatedAt: new Date().toISOString(),
    release: manifest.release || sourceCounts.release,
    counts: {
      orphaPt: ptCount,
      orphaEn: enCount,
      orphaUnion: unionCount,
      ...mappingCounts,
      orphanetEntities: entities.length,
      cidsProjection: cids.length,
      terminologiesOrpha: terminologies.length,
    },
    errors,
    warnings,
  };
  await writeValidationReport(artifact, report);

  if (errors.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log('[orphanet-validate-initial-seed] PASS');
  console.log(JSON.stringify(report.counts, null, 2));
}

main().catch(async (error) => {
  console.error(`[orphanet-validate-initial-seed] ${error.stack || error.message}`);
  process.exit(1);
});
