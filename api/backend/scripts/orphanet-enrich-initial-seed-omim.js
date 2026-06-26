const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { OrphacodeApiClient, normalizeApiLang } = require('../src/services/orphanet/orphacodeApiClient');

const SOURCE_API = 'ORPHAcodes API / RD-CODE';
const LOCAL_OMIM_EXTENSIONS = new Set(['.xlsx', '.csv', '.tsv', '.json', '.jsonl']);
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

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(';');
  if (typeof value === 'object') {
    return text(value.code || value.Code || value.reference || value.Reference || value.id || value.value || value.label || value.name || value.text);
  }
  return '';
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function normalizeOrphaNumeric(value) {
  const raw = text(value).replace(/^ORPHA:/i, '').trim();
  if (!raw || /^HP:/i.test(raw)) return '';
  const match = raw.match(/\d+/);
  return match ? match[0] : '';
}

function normalizeOmimCode(value) {
  const raw = text(value).replace(/^OMIM:/i, '').trim();
  if (!raw || /^HP:/i.test(raw)) return '';
  const match = raw.match(/\d{3,}/);
  return match ? match[0] : '';
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonl(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJsonl(filePath, rows) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.promises.writeFile(filePath, body ? `${body}\n` : '', 'utf8');
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

async function readCheckpoint(filePath, enabled) {
  if (!enabled || !fs.existsSync(filePath)) return { done: [], notFound: [], errors: [] };
  return readJson(filePath);
}

async function writeCheckpoint(filePath, checkpoint, enabled) {
  if (!enabled) return;
  await writeJson(filePath, checkpoint);
}

async function resetCheckpoint(filePath, enabled) {
  if (!enabled || !filePath || !fs.existsSync(filePath)) return false;
  await fs.promises.unlink(filePath);
  return true;
}

function inferRawDir(artifact, sourceCounts) {
  const sourcePath = sourceCounts?.sources?.ptZip?.path || sourceCounts?.sources?.enZip?.path || '';
  if (sourcePath) return path.dirname(sourcePath);
  return path.resolve(path.dirname(artifact), '..', 'orpha-data-raw');
}

function findLocalOmimFile(rawDir) {
  if (!rawDir || !fs.existsSync(rawDir)) return '';
  const candidates = fs.readdirSync(rawDir)
    .filter((name) => /OMIM/i.test(name) && LOCAL_OMIM_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();
  return candidates.length ? path.join(rawDir, candidates[0]) : '';
}

function pickField(row, names) {
  const lowerToKey = Object.fromEntries(Object.keys(row || {}).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = lowerToKey[name.toLowerCase()];
    if (key) return row[key];
  }
  return '';
}

function splitCodes(value) {
  if (Array.isArray(value)) return value.flatMap(splitCodes);
  return String(value || '')
    .split(/[;,|]/)
    .map(normalizeOmimCode)
    .filter(Boolean);
}

function rowsToMappings(rows, release) {
  const mappings = [];
  for (const row of rows) {
    const canonicalCode = normalizeOrphaNumeric(pickField(row, ['orphaCode', 'ORPHAcode', 'ORPHA', 'sourceCanonicalCode', 'sourceCode', 'code']));
    if (!canonicalCode) continue;
    const omimValues = splitCodes(pickField(row, ['OMIM', 'omim', 'omimCode', 'omimCodes', 'targetCode']));
    for (const targetCode of omimValues) {
      mappings.push(buildOmimMapping(canonicalCode, targetCode, release, 'local-file'));
    }
  }
  return mappings;
}

function parseDelimited(content, delimiter) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(delimiter).map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

async function readLocalOmimMappings(filePath, release) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jsonl') {
    return rowsToMappings(await readJsonl(filePath), release);
  }
  if (ext === '.json') {
    const payload = await readJson(filePath);
    const rows = Array.isArray(payload) ? payload : (payload.rows || payload.data || payload.items || []);
    return rowsToMappings(rows, release);
  }
  if (ext === '.csv' || ext === '.tsv') {
    const rows = parseDelimited(await fs.promises.readFile(filePath, 'utf8'), ext === '.tsv' ? '\t' : ',');
    return rowsToMappings(rows, release);
  }
  if (ext === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    let headerRow = 0;
    let headers = {};
    worksheet.eachRow((row, rowNumber) => {
      if (headerRow) return;
      const values = row.values.map((value) => String(value || '').trim().toLowerCase());
      if (values.some((value) => /orpha/.test(value)) && values.some((value) => /omim/.test(value))) {
        headerRow = rowNumber;
        row.eachCell((cell, colNumber) => {
          headers[String(cell.value || '').trim()] = colNumber;
        });
      }
    });
    const rows = [];
    for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      rows.push(Object.fromEntries(Object.entries(headers).map(([key, col]) => [key, row.getCell(col).value])));
    }
    return rowsToMappings(rows, release);
  }
  return [];
}

function omimReferences(payload) {
  if (Array.isArray(payload?.References)) return payload.References;
  if (Array.isArray(payload?.references)) return payload.references;
  return [];
}

function hasOmimReferences(payload) {
  return omimReferences(payload).length > 0;
}

function extractOmimMappings(payload, fallbackOrphaCode) {
  const refs = omimReferences(payload);

  return refs
    .map((ref) => ({
      sourceCanonicalCode: normalizeOrphaNumeric(payload?.ORPHAcode || payload?.orphaCode || fallbackOrphaCode),
      omimCode: normalizeOmimCode(
        ref?.['Code OMIM']
        || ref?.CodeOMIM
        || ref?.codeOMIM
        || ref?.omimCode
        || ref?.code
        || ''
      ),
      mappingRelation: String(
        ref?.DisorderMappingRelation
        || ref?.mappingRelation
        || ''
      ).trim(),
      validationStatus: String(
        ref?.DisorderMappingValidationStatus
        || ref?.validationStatus
        || ''
      ).trim(),
    }))
    .filter((item) => item.omimCode);
}

function buildOmimMapping(canonicalCode, targetCode, release, method = 'api-enrichment', details = {}) {
  return {
    sourceSystem: 'ORPHA',
    sourceCode: `ORPHA:${canonicalCode}`,
    sourceCanonicalCode: canonicalCode,
    targetSystem: 'OMIM',
    targetCode: normalizeOmimCode(targetCode),
    relationType: 'mapping',
    mappingRelation: details.mappingRelation || '',
    validationStatus: details.validationStatus || '',
    source: method === 'local-file' ? 'Local OMIM file' : SOURCE_API,
    release,
    enrichmentMethod: method,
    active: true,
  };
}

function dedupeMappings(rows) {
  const map = new Map();
  for (const row of rows) {
    const targetCode = row.targetSystem === 'OMIM'
      ? normalizeOmimCode(row.targetCode)
      : text(row.targetCode);
    const sourceCanonicalCode = normalizeOrphaNumeric(row.sourceCanonicalCode || row.sourceCode);
    const normalizedRow = row.targetSystem === 'OMIM'
      ? { ...row, sourceCanonicalCode, sourceCode: `ORPHA:${sourceCanonicalCode}`, targetCode }
      : row;
    const key = `${normalizedRow.sourceSystem}:${sourceCanonicalCode}:${normalizedRow.targetSystem}:${targetCode}`;
    if (!targetCode || !sourceCanonicalCode) continue;
    map.set(key, { ...(map.get(key) || {}), ...normalizedRow });
  }
  return Array.from(map.values());
}

function isNotFoundError(error) {
  return error?.status === 404 || /\bHTTP 404\b/i.test(String(error?.message || ''));
}

async function fetchOmimMappings({ artifact, entities, release, lang, concurrency, checkpoint, checkpointPath, client }) {
  const existingDone = new Set(checkpoint.done || []);
  const notFound = new Set(checkpoint.notFound || []);
  const errors = checkpoint.errors || [];
  const output = [];
  const queue = entities.map((row) => row.canonicalCode).filter(Boolean);
  let cursor = 0;
  let processedThisRun = 0;
  let foundEntities = 0;
  let foundMappings = 0;

  async function worker() {
    while (cursor < queue.length) {
      const canonicalCode = queue[cursor];
      cursor += 1;
      if (existingDone.has(canonicalCode) || notFound.has(canonicalCode)) continue;
      try {
        const payload = await client.clinicalEntityResource(lang, canonicalCode, 'OMIM');
        if (!payload || !hasOmimReferences(payload)) {
          notFound.add(canonicalCode);
          existingDone.add(canonicalCode);
        } else {
          const mappings = extractOmimMappings(payload, canonicalCode);
          foundEntities += 1;
          for (const mapping of mappings) {
            output.push(buildOmimMapping(
              mapping.sourceCanonicalCode || canonicalCode,
              mapping.omimCode,
              release,
              'api-enrichment',
              {
                mappingRelation: mapping.mappingRelation,
                validationStatus: mapping.validationStatus,
              }
            ));
          }
          foundMappings += mappings.length;
          existingDone.add(canonicalCode);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          notFound.add(canonicalCode);
          existingDone.add(canonicalCode);
        } else {
          errors.push({ canonicalCode, message: error.message, at: new Date().toISOString() });
        }
      }
      processedThisRun += 1;
      if (processedThisRun % 25 === 0) {
        console.log(`[orphanet-enrich-omim] processed=${processedThisRun} done=${existingDone.size} notFound=${notFound.size} foundEntities=${foundEntities} foundMappings=${foundMappings}`);
      }
      await writeCheckpoint(checkpointPath, {
        artifact,
        lang,
        updatedAt: new Date().toISOString(),
        done: Array.from(existingDone),
        notFound: Array.from(notFound),
        errors,
      }, Boolean(checkpointPath));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    mappings: output,
    checkpoint: {
      artifact,
      lang,
      updatedAt: new Date().toISOString(),
      done: Array.from(existingDone),
      notFound: Array.from(notFound),
      errors,
    },
    processedThisRun,
    foundEntities,
    foundMappings,
  };
}

function updateCidsProjection(cids, mappings) {
  const omimByCode = new Map();
  for (const mapping of mappings) {
    if (mapping.targetSystem !== 'OMIM') continue;
    if (!omimByCode.has(mapping.sourceCanonicalCode)) omimByCode.set(mapping.sourceCanonicalCode, []);
    omimByCode.get(mapping.sourceCanonicalCode).push(mapping.targetCode);
  }
  return cids.map((row) => ({
    ...row,
    icd10Codes: row.icd10Codes || [],
    icd11Codes: row.icd11Codes || [],
    snomedCtCodes: row.snomedCtCodes || [],
    omimCodes: unique([...(row.omimCodes || []), ...(omimByCode.get(String(row.orphaCode || '').replace(/^ORPHA:/i, '')) || [])]),
  }));
}

async function updateArtifactMetadata(artifact, release, enrichmentSummary) {
  const normalizedCounts = {};
  for (const fileName of JSONL_FILES) {
    normalizedCounts[fileName.replace(/\.jsonl$/, '')] = (await readJsonl(artifactFile(artifact, `normalized/${fileName}`))).length;
  }
  await writeJson(artifactFile(artifact, 'validation/normalized_counts.json'), normalizedCounts);

  const checksumsPath = artifactFile(artifact, 'validation/checksums.json');
  const checksums = fs.existsSync(checksumsPath) ? await readJson(checksumsPath) : { sources: {}, artifacts: {} };
  checksums.artifacts = checksums.artifacts || {};
  for (const fileName of JSONL_FILES) {
    const relative = `normalized/${fileName}`;
    checksums.artifacts[relative] = await checksumFile(artifactFile(artifact, relative));
  }
  for (const relative of ['validation/source_counts.json', 'validation/normalized_counts.json']) {
    checksums.artifacts[relative] = await checksumFile(artifactFile(artifact, relative));
  }
  await writeJson(checksumsPath, checksums);

  const report = {
    status: 'ENRICHED',
    generatedAt: new Date().toISOString(),
    release,
    enrichment: enrichmentSummary,
    message: 'Run orphanet-validate-initial-seed.js to produce PASS/FAIL.',
  };
  await writeJson(artifactFile(artifact, 'validation/validation_report.json'), report);

  const manifestPath = artifactFile(artifact, 'manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.generatedAt = manifest.generatedAt || new Date().toISOString();
  manifest.updatedAt = new Date().toISOString();
  manifest.normalizedCounts = normalizedCounts;
  manifest.enrichments = [
    ...(manifest.enrichments || []).filter((item) => item.name !== 'OMIM'),
    enrichmentSummary,
  ];
  await writeJson(manifestPath, manifest);
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`[selfTest] ${message}`);
}

async function runSelfTest() {
  const payload324 = {
    ORPHAcode: 324,
    'Preferred term': 'Fabry disease',
    Date: '2025-06-24 08:03:56',
    References: [
      {
        'Code OMIM': '301500',
        DisorderMappingRelation: 'E (Exact mapping: the two concepts are equivalent)',
        DisorderMappingValidationStatus: 'Validated',
      },
    ],
  };
  const payload100 = {
    ORPHAcode: 100,
    'Preferred term': 'Ataxia-telangiectasia',
    References: [
      {
        'Code OMIM': '208900',
        DisorderMappingRelation: 'BTNT (ORPHAcode is broader than the targeted code used to represent it)',
        DisorderMappingValidationStatus: 'Validated',
      },
      {
        'Code OMIM': '208910',
        DisorderMappingRelation: 'NTBT (ORPHAcode is narrower than the targeted code used to represent it)',
        DisorderMappingValidationStatus: 'Validated',
      },
    ],
  };

  const mappings324 = extractOmimMappings(payload324, '324');
  const mappings100 = extractOmimMappings(payload100, '100');
  const emptyMappings = extractOmimMappings({ ORPHAcode: 4040, References: [] }, '4040');

  assertSelfTest(mappings324.length === 1, 'ORPHA 324 should have one OMIM mapping');
  assertSelfTest(mappings324[0].omimCode === '301500', 'ORPHA 324 should extract OMIM 301500');
  assertSelfTest(mappings100.map((item) => item.omimCode).join(',') === '208900,208910', 'ORPHA 100 should extract OMIM 208900 and 208910');
  assertSelfTest(emptyMappings.length === 0, 'References: [] should return no mappings');

  const builtMappings = [
    buildOmimMapping('324', mappings324[0].omimCode, '2025-07', 'api-enrichment', mappings324[0]),
    ...mappings100.map((item) => buildOmimMapping('100', item.omimCode, '2025-07', 'api-enrichment', item)),
  ];
  assertSelfTest(builtMappings.every((item) => item.targetSystem === 'OMIM'), 'all built mappings should target OMIM');

  const fakeClient = {
    async clinicalEntityResource(_lang, canonicalCode) {
      if (canonicalCode === '324') return payload324;
      if (canonicalCode === '100') return payload100;
      if (canonicalCode === 'empty') return { ORPHAcode: 'empty', References: [] };
      const error = new Error('HTTP 404');
      error.status = 404;
      throw error;
    },
  };
  const result = await fetchOmimMappings({
    artifact: 'self-test',
    entities: [
      { canonicalCode: '324' },
      { canonicalCode: '100' },
      { canonicalCode: 'empty' },
      { canonicalCode: '404' },
    ],
    release: '2025-07',
    lang: 'EN',
    concurrency: 1,
    checkpoint: { done: [], notFound: [], errors: [] },
    checkpointPath: '',
    client: fakeClient,
  });

  assertSelfTest(result.mappings.length === 3, 'fake fetch should produce three mappings');
  assertSelfTest(result.mappings.every((item) => item.targetSystem === 'OMIM'), 'fake fetch mappings should target OMIM');
  assertSelfTest(result.checkpoint.notFound.includes('empty'), 'empty References should be notFound');
  assertSelfTest(result.checkpoint.notFound.includes('404'), 'simulated 404/null payload should be notFound');
  assertSelfTest(result.foundEntities === 2, 'foundEntities should count payloads with References');
  assertSelfTest(result.foundMappings === 3, 'foundMappings should count extracted OMIM mappings');

  const updatedCids = updateCidsProjection([
    {
      orphaCode: '324',
      icd10Codes: ['E75.2'],
      icd11Codes: ['5C56.0'],
      snomedCtCodes: ['16652001'],
      omimCodes: [],
    },
  ], result.mappings);
  assertSelfTest(updatedCids[0].omimCodes.join(',') === '301500', 'cids_projection should receive numeric OMIM code');
  assertSelfTest(updatedCids[0].icd10Codes[0] === 'E75.2', 'cids_projection should preserve icd10Codes');
  assertSelfTest(updatedCids[0].icd11Codes[0] === '5C56.0', 'cids_projection should preserve icd11Codes');
  assertSelfTest(updatedCids[0].snomedCtCodes[0] === '16652001', 'cids_projection should preserve snomedCtCodes');

  console.log('[orphanet-enrich-omim] selfTest PASS');
  console.log(JSON.stringify({
    extracted324: mappings324.map((item) => item.omimCode),
    extracted100: mappings100.map((item) => item.omimCode),
    notFound: result.checkpoint.notFound,
    foundEntities: result.foundEntities,
    foundMappings: result.foundMappings,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.selfTest) {
    await runSelfTest();
    return;
  }

  const startedAt = Date.now();
  const artifact = path.resolve(args.artifact || './artifacts/orphanet-2025-07-initial-seed');
  const release = args.release || '2025-07';
  const lang = normalizeApiLang(args.lang || 'EN');
  if (args.resetOmimCheckpoint) {
    const checkpointPath = path.join(artifact, `.orphanet-omim-${lang.toLowerCase()}-checkpoint.json`);
    const didResetCheckpoint = await resetCheckpoint(checkpointPath, true);
    console.log(`[orphanet-enrich-omim] reset checkpoint=${checkpointPath} removed=${didResetCheckpoint}`);
    return;
  }

  const concurrency = Math.max(Number(args.concurrency || 3), 1);
  const delayMs = Number(args.delayMs ?? 150);
  const sourceCounts = await readJson(artifactFile(artifact, 'validation/source_counts.json'));
  const rawDir = path.resolve(args.input || inferRawDir(artifact, sourceCounts));
  const localOmim = args.omim ? path.resolve(args.omim) : findLocalOmimFile(rawDir);

  const entities = await readJsonl(artifactFile(artifact, 'normalized/orphanet_entities.jsonl'));
  const cids = await readJsonl(artifactFile(artifact, 'normalized/cids_projection.jsonl'));
  const existingMappings = await readJsonl(artifactFile(artifact, 'normalized/terminology_mappings.jsonl'));
  let newMappings = [];
  let source = 'api';
  let processedThisRun = 0;
  let foundEntities = 0;
  let foundMappings = 0;

  if (localOmim) {
    source = 'local-file';
    newMappings = await readLocalOmimMappings(localOmim, release);
    console.log(`[orphanet-enrich-omim] local OMIM source=${localOmim} mappings=${newMappings.length}`);
  } else {
    const checkpointPath = args.checkpoint
      ? path.join(artifact, `.orphanet-omim-${lang.toLowerCase()}-checkpoint.json`)
      : '';
    const checkpoint = await readCheckpoint(checkpointPath, Boolean(args.checkpoint));
    const client = new OrphacodeApiClient({
      apiKey: args.apiKey,
      langs: [lang],
      delayMs,
      concurrency,
      timeoutMs: args.timeoutMs,
      retries: args.retries,
      baseUrl: args.baseUrl,
      quiet: true,
    });
    const result = await fetchOmimMappings({
      artifact,
      entities,
      release,
      lang,
      concurrency,
      checkpoint,
      checkpointPath,
      client,
    });
    newMappings = result.mappings;
    processedThisRun = result.processedThisRun;
    foundEntities = result.foundEntities;
    foundMappings = result.foundMappings;
    await writeCheckpoint(checkpointPath, result.checkpoint, Boolean(args.checkpoint));
    console.log(`[orphanet-enrich-omim] processed=${processedThisRun} done=${result.checkpoint.done.length} notFound=${result.checkpoint.notFound.length} foundEntities=${foundEntities} foundMappings=${foundMappings}`);
  }

  const mergedMappings = dedupeMappings([...existingMappings, ...newMappings])
    .sort((a, b) => `${a.sourceCode}:${a.targetSystem}:${a.targetCode}`.localeCompare(`${b.sourceCode}:${b.targetSystem}:${b.targetCode}`));
  const updatedCids = updateCidsProjection(cids, mergedMappings);
  await writeJsonl(artifactFile(artifact, 'normalized/terminology_mappings.jsonl'), mergedMappings);
  await writeJsonl(artifactFile(artifact, 'normalized/cids_projection.jsonl'), updatedCids);

  const omimMappings = mergedMappings.filter((row) => row.targetSystem === 'OMIM').length;
  const enrichmentSummary = {
    name: 'OMIM',
    source,
    localFile: localOmim || '',
    method: source === 'local-file' ? 'local-file' : 'api-enrichment',
    endpoint: source === 'api' ? `/${lang}/ClinicalEntity/orphacode/<codigo>/OMIM` : '',
    lang,
    release,
    processedThisRun,
    foundEntities,
    foundMappings,
    newMappings: newMappings.length,
    totalOmimMappings: omimMappings,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    completedAt: new Date().toISOString(),
  };
  await updateArtifactMetadata(artifact, release, enrichmentSummary);

  console.log('[orphanet-enrich-omim] completed');
  console.log(JSON.stringify(enrichmentSummary, null, 2));
}

main().catch((error) => {
  console.error(`[orphanet-enrich-omim] ${error.stack || error.message}`);
  process.exit(1);
});
