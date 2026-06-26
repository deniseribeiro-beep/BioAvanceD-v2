const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const ExcelJS = require('exceljs');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const DEFAULT_RELEASE = '2025-07';
const SOURCE_PACK = 'Orphanet Nomenclature Pack / RD-CODE';
const SOURCE_SEED = 'BioAvanceD ORPHA initial seed';
const SOURCE_SNOMED = 'ORPHA-SNOMEDCT Mapping File';
const SNOMED_RELEASE = '2025-07 International Release';
const MAX_XML_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;

const JSONL_FILES = {
  orphanet_entities: 'orphanet_entities.jsonl',
  cids_projection: 'cids_projection.jsonl',
  terminology_mappings: 'terminology_mappings.jsonl',
  orphanet_classifications: 'orphanet_classifications.jsonl',
  terminologies_orpha: 'terminologies_orpha.jsonl',
};

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

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    return text(value['#text'] || value._ || value.Name || value.name || value.label || value.value);
  }
  return '';
}

function stripTags(value) {
  return text(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function normalizeOrphaNumeric(value) {
  const raw = text(value).replace(/^ORPHA:/i, '').trim();
  if (!raw || /^HP:/i.test(raw)) return '';
  const match = raw.match(/^\d+$/) || raw.match(/\d+/);
  return match ? match[0] : '';
}

function orphaCode(value) {
  const numeric = normalizeOrphaNumeric(value);
  return numeric ? `ORPHA:${numeric}` : '';
}

function normalizeTargetSystem(value) {
  const raw = text(value).toUpperCase().replace(/[\s_]+/g, '-');
  if (['ICD10', 'ICD-10', 'CID10', 'CID-10', 'CIM10', 'CIM-10'].includes(raw)) return 'ICD10';
  if (['ICD11', 'ICD-11'].includes(raw)) return 'ICD11';
  if (['SNOMEDCT', 'SNOMED-CT'].includes(raw)) return 'SNOMED_CT';
  return raw;
}

function isActiveStatus(status) {
  return !/obsolete|deprecated|inactive|inativo|obsoleto/i.test(text(status));
}

function localizedText(value) {
  return stripTags(value);
}

function resolveOutputPath(root, fileName) {
  return path.join(root, ...String(fileName).split(/[\\/]/));
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, rows) {
  await ensureDir(path.dirname(filePath));
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

async function buildArtifactChecksums(outDir) {
  const artifacts = {};
  for (const fileName of Object.values(JSONL_FILES)) {
    const relative = `normalized/${fileName}`;
    artifacts[relative] = await checksumFile(resolveOutputPath(outDir, relative));
  }
  for (const relative of ['validation/source_counts.json', 'validation/normalized_counts.json']) {
    artifacts[relative] = await checksumFile(resolveOutputPath(outDir, relative));
  }
  return artifacts;
}

function findOneFile(inputDir, matcher, label) {
  if (!inputDir || !fs.existsSync(inputDir)) return '';
  const entries = fs.readdirSync(inputDir);
  const found = entries.find((entry) => matcher(entry));
  if (!found) throw new Error(`Could not locate ${label} under ${inputDir}`);
  return path.join(inputDir, found);
}

function resolveSources(args) {
  const input = args.input || './orpha-data-raw';
  return {
    pt: path.resolve(args.pt || findOneFile(input, (name) => /Nomenclature_Pack_PT\.zip$/i.test(name), 'PT nomenclature ZIP')),
    en: path.resolve(args.en || findOneFile(input, (name) => /Nomenclature_Pack_EN\.zip$/i.test(name), 'EN nomenclature ZIP')),
    snomed: path.resolve(args.snomed || findOneFile(input, (name) => /SNOMED.*\.xlsx$/i.test(name), 'SNOMED XLSX')),
  };
}

function decodeXmlBuffer(buffer, entryName) {
  let xml = buffer.toString('utf8');
  if (XMLValidator.validate(xml) !== true) {
    xml = buffer.toString('latin1');
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error(`Unsafe XML declaration found in ${entryName}`);
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Invalid XML in ${entryName}: ${validation?.err?.msg || 'validation failed'}`);
  }
  return xml;
}

function readZipXmlEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
      if (openError) return reject(openError);
      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName) || !/\.xml$/i.test(entry.fileName)) {
          zipFile.readEntry();
          return;
        }
        if (entry.uncompressedSize > MAX_XML_UNCOMPRESSED_BYTES) {
          reject(new Error(`XML entry too large: ${entry.fileName}`));
          zipFile.close();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          let total = 0;
          stream.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_XML_UNCOMPRESSED_BYTES) {
              stream.destroy(new Error(`XML entry exceeded limit: ${entry.fileName}`));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            entries.push({
              name: entry.fileName,
              xml: decodeXmlBuffer(Buffer.concat(chunks), entry.fileName),
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
            });
            zipFile.readEntry();
          });
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
      return null;
    });
  });
}

function createXmlParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
  });
}

function rootOf(parsed) {
  return parsed.JDBOR || parsed.JDBORPHANET || parsed;
}

function extractDefinition(disorder) {
  const summaries = asArray(disorder?.SummaryInformationList?.SummaryInformation);
  for (const summary of summaries) {
    const sections = asArray(summary?.TextSectionList?.TextSection);
    const definition = sections.find((section) => /definition|defini/i.test(text(section?.TextSectionType?.Name)));
    if (definition?.Contents) return stripTags(definition.Contents);
    if (sections[0]?.Contents) return stripTags(sections[0].Contents);
  }
  return '';
}

function mergeLanguageRecord(map, code, language, patch) {
  if (!map.has(code)) {
    map.set(code, {
      canonicalCode: code,
      code: `ORPHA:${code}`,
      labels: {},
      synonyms: {},
      definitions: {},
      typologyByLang: {},
      statusByLang: {},
      classificationLevelByLang: {},
      activeByLang: {},
    });
  }
  const record = map.get(code);
  if (patch.label) record.labels[language] = patch.label;
  record.synonyms[language] = unique([...(record.synonyms[language] || []), ...(patch.synonyms || [])]);
  if (patch.definition) record.definitions[language] = patch.definition;
  if (patch.typology) record.typologyByLang[language] = patch.typology;
  if (patch.status) record.statusByLang[language] = patch.status;
  if (patch.classificationLevel) record.classificationLevelByLang[language] = patch.classificationLevel;
  if (patch.active !== undefined) record.activeByLang[language] = patch.active;
}

function extractNomenclature(root, language, entitiesByCode) {
  const disorders = asArray(root?.DisorderList?.Disorder);
  for (const disorder of disorders) {
    const code = normalizeOrphaNumeric(disorder.OrphaCode);
    if (!code) continue;
    mergeLanguageRecord(entitiesByCode, code, language, {
      label: localizedText(disorder.Name),
      synonyms: unique(asArray(disorder?.SynonymList?.Synonym).map(localizedText)),
      definition: extractDefinition(disorder),
      typology: localizedText(disorder?.DisorderType?.Name),
      status: localizedText(disorder.Totalstatus),
      classificationLevel: localizedText(disorder?.ClassificationLevel?.Name),
      active: isActiveStatus(disorder.Totalstatus),
    });
  }
  return {
    rowsExtracted: disorders.length,
    distinctOrphaCodes: new Set(disorders.map((item) => normalizeOrphaNumeric(item.OrphaCode)).filter(Boolean)).size,
  };
}

function extractMappingXml(root, language, expectedSystem, release) {
  const rows = [];
  const disorders = asArray(root?.DisorderList?.Disorder);
  for (const disorder of disorders) {
    const canonicalCode = normalizeOrphaNumeric(disorder.OrphaCode);
    if (!canonicalCode) continue;
    for (const ref of asArray(disorder?.ExternalReferenceList?.ExternalReference)) {
      const targetSystem = normalizeTargetSystem(ref.Source);
      const targetCode = text(ref.Reference);
      if (targetSystem !== expectedSystem || !targetCode || /^HP:/i.test(targetCode)) continue;
      rows.push({
        sourceSystem: 'ORPHA',
        sourceCode: `ORPHA:${canonicalCode}`,
        sourceCanonicalCode: canonicalCode,
        targetSystem,
        targetCode,
        relationType: 'mapping',
        mappingRelation: localizedText(ref?.DisorderMappingRelation?.Name),
        mappingValidationStatus: localizedText(ref?.DisorderMappingValidationStatus?.Name),
        language,
        source: SOURCE_PACK,
        release,
        active: true,
      });
    }
  }
  return rows;
}

function classificationNodeRows(classification, node, language, release, sourceFile, parentCode = '', depth = 0) {
  const rows = [];
  const disorder = node?.Disorder || {};
  const canonicalCode = normalizeOrphaNumeric(disorder.OrphaCode);
  if (canonicalCode) {
    rows.push({
      hchid: `${classification.orphaNumber || 'classification'}:${parentCode || 'root'}:${canonicalCode}:${language}`,
      classificationOrphaNumber: classification.orphaNumber || '',
      classificationName: classification.name || '',
      orphaCode: `ORPHA:${canonicalCode}`,
      parentOrphaCode: parentCode ? `ORPHA:${parentCode}` : '',
      childOrphaCode: `ORPHA:${canonicalCode}`,
      language,
      classificationLevel: String(depth),
      label: localizedText(disorder.Name),
      typology: localizedText(disorder?.DisorderType?.Name),
      sourceFile,
      release,
      source: SOURCE_PACK,
      active: true,
    });
  }

  for (const child of asArray(node?.ClassificationNodeChildList?.ClassificationNode)) {
    rows.push(...classificationNodeRows(classification, child, language, release, sourceFile, canonicalCode, depth + 1));
  }
  return rows;
}

function extractClassificationXml(root, language, release, sourceFile) {
  const rows = [];
  for (const classification of asArray(root?.ClassificationList?.Classification)) {
    const meta = {
      orphaNumber: text(classification.OrphaNumber),
      name: localizedText(classification.Name),
    };
    for (const node of asArray(classification?.ClassificationNodeRootList?.ClassificationNode)) {
      rows.push(...classificationNodeRows(meta, node, language, release, sourceFile));
    }
  }
  return rows;
}

function extractLinearisationXml(root, language, release, sourceFile) {
  const rows = [];
  for (const disorder of asArray(root?.DisorderList?.Disorder)) {
    const child = normalizeOrphaNumeric(disorder.OrphaCode);
    if (!child) continue;
    for (const association of asArray(disorder?.DisorderDisorderAssociationList?.DisorderDisorderAssociation)) {
      const parent = normalizeOrphaNumeric(association?.TargetDisorder?.OrphaCode);
      if (!parent) continue;
      rows.push({
        hchid: `linearisation:${parent}:${child}:${language}`,
        classificationOrphaNumber: '',
        classificationName: 'ORPHA linearisation',
        orphaCode: `ORPHA:${child}`,
        parentOrphaCode: `ORPHA:${parent}`,
        childOrphaCode: `ORPHA:${child}`,
        language,
        classificationLevel: localizedText(association?.DisorderDisorderAssociationType?.Name),
        label: localizedText(disorder.Name),
        sourceFile,
        release,
        source: SOURCE_PACK,
        active: true,
      });
    }
  }
  return rows;
}

async function parsePack(zipPath, language, release, entitiesByCode) {
  const parser = createXmlParser();
  const entries = await readZipXmlEntries(zipPath);
  const counts = {
    zipPath,
    xmlFileCount: entries.length,
    xmlFiles: entries.map((entry) => ({
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    })),
    nomenclatureRows: 0,
    distinctOrphaCodes: 0,
    icd10Mappings: 0,
    icd11Mappings: 0,
    classificationRows: 0,
    linearisationRows: 0,
  };
  const mappings = [];
  const classifications = [];

  for (const entry of entries) {
    const root = rootOf(parser.parse(entry.xml));
    if (/ORPHAnomenclature_[a-z]{2}_\d{4}\.xml$/i.test(entry.name)) {
      const extracted = extractNomenclature(root, language, entitiesByCode);
      counts.nomenclatureRows += extracted.rowsExtracted;
      counts.distinctOrphaCodes = extracted.distinctOrphaCodes;
    } else if (/ORPHA_ICD10_mapping/i.test(entry.name)) {
      const rows = extractMappingXml(root, language, 'ICD10', release);
      counts.icd10Mappings += rows.length;
      mappings.push(...rows);
    } else if (/ORPHA_ICD11_mapping/i.test(entry.name)) {
      const rows = extractMappingXml(root, language, 'ICD11', release);
      counts.icd11Mappings += rows.length;
      mappings.push(...rows);
    } else if (/ORPHAclassification_/i.test(entry.name)) {
      const rows = extractClassificationXml(root, language, release, entry.name);
      counts.classificationRows += rows.length;
      classifications.push(...rows);
    } else if (/ORPHAlinearisation/i.test(entry.name)) {
      const rows = extractLinearisationXml(root, language, release, entry.name);
      counts.linearisationRows += rows.length;
      classifications.push(...rows);
    }
  }

  return { counts, mappings, classifications };
}

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.richText) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (value.hyperlink && value.text) return String(value.text).trim();
  }
  return String(value).trim();
}

async function parseSnomedXlsx(xlsxPath, release) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`No worksheet found in ${xlsxPath}`);

  let headerRowNumber = 0;
  let columns = {};
  worksheet.eachRow((row, rowNumber) => {
    if (headerRowNumber) return;
    const values = row.values.map((value) => String(value || '').trim().toLowerCase());
    const hasOrpha = values.includes('orphacode');
    const hasSnomed = values.includes('snomed concept id');
    if (hasOrpha && hasSnomed) {
      headerRowNumber = rowNumber;
      row.eachCell((cell, colNumber) => {
        columns[cellText(cell).toLowerCase()] = colNumber;
      });
    }
  });

  if (!headerRowNumber) throw new Error(`Could not find SNOMED header row in ${xlsxPath}`);
  const rows = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const canonicalCode = normalizeOrphaNumeric(cellText(row.getCell(columns.orphacode)));
    const targetCode = cellText(row.getCell(columns['snomed concept id']));
    if (!canonicalCode || !targetCode) continue;
    rows.push({
      sourceSystem: 'ORPHA',
      sourceCode: `ORPHA:${canonicalCode}`,
      sourceCanonicalCode: canonicalCode,
      targetSystem: 'SNOMED_CT',
      targetCode,
      sourceTerm: cellText(row.getCell(columns['orpha main term'])),
      relationType: 'mapping',
      source: SOURCE_SNOMED,
      orphanetRelease: release,
      snomedRelease: SNOMED_RELEASE,
      active: true,
    });
  }
  return {
    worksheet: worksheet.name,
    headerRowNumber,
    rows,
    distinctOrphaCodes: new Set(rows.map((row) => row.sourceCanonicalCode)).size,
  };
}

function chooseLangValue(record, field, preferred = ['pt', 'en']) {
  for (const language of preferred) {
    if (record[field]?.[language]) return record[field][language];
  }
  return Object.values(record[field] || {}).find(Boolean) || '';
}

function finalizeEntities(entitiesByCode, release) {
  return Array.from(entitiesByCode.values())
    .sort((a, b) => Number(a.canonicalCode) - Number(b.canonicalCode))
    .map((record) => ({
      system: 'ORPHA',
      code: record.code,
      canonicalCode: record.canonicalCode,
      domain: 'rare_disease',
      labels: {
        pt: record.labels.pt || '',
        en: record.labels.en || '',
      },
      synonyms: {
        pt: record.synonyms.pt || [],
        en: record.synonyms.en || [],
      },
      definitions: {
        pt: record.definitions.pt || '',
        en: record.definitions.en || '',
      },
      typology: chooseLangValue(record, 'typologyByLang'),
      status: chooseLangValue(record, 'statusByLang'),
      classificationLevel: chooseLangValue(record, 'classificationLevelByLang'),
      source: SOURCE_PACK,
      release,
      active: !Object.values(record.activeByLang).some((active) => active === false),
    }));
}

function dedupeBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function buildOutputs({ entities, mappings, classifications, release }) {
  const mappingRows = dedupeBy(mappings, (row) => [
    row.sourceSystem,
    row.sourceCode,
    row.targetSystem,
    row.targetCode,
  ].join(':')).sort((a, b) => `${a.sourceCode}:${a.targetSystem}:${a.targetCode}`.localeCompare(`${b.sourceCode}:${b.targetSystem}:${b.targetCode}`));

  const mappingsByCode = new Map();
  for (const row of mappingRows) {
    if (!mappingsByCode.has(row.sourceCanonicalCode)) mappingsByCode.set(row.sourceCanonicalCode, []);
    mappingsByCode.get(row.sourceCanonicalCode).push(row);
  }

  return {
    orphanet_entities: entities,
    cids_projection: entities.map((entity) => {
      const rows = mappingsByCode.get(entity.canonicalCode) || [];
      return {
        orphaCode: entity.canonicalCode,
        code: entity.code,
        system: 'ORPHA',
        label: entity.labels.pt || entity.labels.en || entity.code,
        labels: entity.labels,
        icd10Codes: unique(rows.filter((row) => row.targetSystem === 'ICD10').map((row) => row.targetCode)),
        icd11Codes: unique(rows.filter((row) => row.targetSystem === 'ICD11').map((row) => row.targetCode)),
        snomedCtCodes: unique(rows.filter((row) => row.targetSystem === 'SNOMED_CT').map((row) => row.targetCode)),
        omimCodes: unique(rows.filter((row) => row.targetSystem === 'OMIM').map((row) => row.targetCode)),
        source: SOURCE_SEED,
        release,
        active: entity.active,
      };
    }),
    terminology_mappings: mappingRows,
    orphanet_classifications: dedupeBy(classifications, (row) => [
      row.hchid,
      row.orphaCode,
      row.parentOrphaCode,
      row.childOrphaCode,
      row.language,
      row.sourceFile,
    ].join(':')),
    terminologies_orpha: entities.map((entity) => ({
      system: 'ORPHA',
      code: entity.code,
      canonicalCode: entity.canonicalCode,
      label: entity.labels.pt || entity.labels.en || entity.code,
      labels: entity.labels,
      domain: 'rare_disease',
      source: SOURCE_PACK,
      release,
      active: entity.active,
    })),
  };
}

async function writeArtifact({ outDir, normalized, sourceCounts, release, sourceChecksums }) {
  await ensureDir(outDir);
  const normalizedDir = path.join(outDir, 'normalized');
  const validationDir = path.join(outDir, 'validation');

  for (const [key, fileName] of Object.entries(JSONL_FILES)) {
    await writeJsonl(path.join(normalizedDir, fileName), normalized[key]);
  }

  const normalizedCounts = Object.fromEntries(
    Object.entries(JSONL_FILES).map(([key]) => [key, normalized[key].length])
  );
  await writeJson(path.join(validationDir, 'source_counts.json'), sourceCounts);
  await writeJson(path.join(validationDir, 'normalized_counts.json'), normalizedCounts);

  const artifactChecksums = await buildArtifactChecksums(outDir);
  await writeJson(path.join(validationDir, 'checksums.json'), {
    sources: sourceChecksums,
    artifacts: artifactChecksums,
  });
  await writeJson(path.join(validationDir, 'validation_report.json'), {
    status: 'BUILT',
    generatedAt: new Date().toISOString(),
    message: 'Run orphanet-validate-initial-seed.js to produce PASS/FAIL.',
  });

  const manifest = {
    name: 'bioavanced-orphanet-initial-seed',
    release,
    generatedAt: new Date().toISOString(),
    sourceStrategy: 'pack-first + api-enrichment',
    source: SOURCE_PACK,
    apiUse: 'validation/enrichment only; not used for initial full load',
    sources: sourceCounts.sources,
    files: Object.values(JSONL_FILES).map((fileName) => `normalized/${fileName}`),
    validationFiles: [
      'validation/source_counts.json',
      'validation/normalized_counts.json',
      'validation/checksums.json',
      'validation/validation_report.json',
    ],
    normalizedCounts,
    attribution: 'Orphanet / RD-CODE, CC BY 4.0; SNOMED CT mapping file per source terms',
    zipGenerated: false,
    zipNote: 'Use PowerShell Compress-Archive when a ZIP is needed.',
  };
  await writeJson(path.join(outDir, 'manifest.json'), manifest);

  return { manifest, normalizedCounts };
}

async function main() {
  const args = parseArgs(process.argv);
  const release = args.release || DEFAULT_RELEASE;
  const outDir = path.resolve(args.out || './artifacts/orphanet-2025-07-initial-seed');
  const sources = resolveSources(args);

  for (const [label, filePath] of Object.entries(sources)) {
    if (!fs.existsSync(filePath)) throw new Error(`Missing ${label} source: ${filePath}`);
  }

  const sourceChecksums = {
    ptZip: { path: sources.pt, sha256: await checksumFile(sources.pt) },
    enZip: { path: sources.en, sha256: await checksumFile(sources.en) },
    snomedXlsx: { path: sources.snomed, sha256: await checksumFile(sources.snomed) },
  };

  const entitiesByCode = new Map();
  const pt = await parsePack(sources.pt, 'pt', release, entitiesByCode);
  const en = await parsePack(sources.en, 'en', release, entitiesByCode);
  const snomed = await parseSnomedXlsx(sources.snomed, release);

  const entities = finalizeEntities(entitiesByCode, release);
  const allMappings = [...pt.mappings, ...en.mappings, ...snomed.rows];
  const allClassifications = [...pt.classifications, ...en.classifications];
  const normalized = buildOutputs({
    entities,
    mappings: allMappings,
    classifications: allClassifications,
    release,
  });

  const sourceCounts = {
    sourceStrategy: 'pack-first',
    release,
    sources: {
      ptZip: { path: sources.pt, fileName: path.basename(sources.pt), sha256: sourceChecksums.ptZip.sha256 },
      enZip: { path: sources.en, fileName: path.basename(sources.en), sha256: sourceChecksums.enZip.sha256 },
      snomedXlsx: { path: sources.snomed, fileName: path.basename(sources.snomed), sha256: sourceChecksums.snomedXlsx.sha256 },
    },
    packs: {
      pt: pt.counts,
      en: en.counts,
    },
    snomed: {
      xlsxPath: sources.snomed,
      worksheet: snomed.worksheet,
      headerRowNumber: snomed.headerRowNumber,
      rowsExtracted: snomed.rows.length,
      distinctOrphaCodes: snomed.distinctOrphaCodes,
    },
    unionDistinctOrphaCodes: entities.length,
  };

  const result = await writeArtifact({
    outDir,
    normalized,
    sourceCounts,
    release,
    sourceChecksums,
  });

  const counts = {
    orphaPt: sourceCounts.packs.pt.distinctOrphaCodes,
    orphaEn: sourceCounts.packs.en.distinctOrphaCodes,
    orphaUnion: sourceCounts.unionDistinctOrphaCodes,
    icd10Mappings: normalized.terminology_mappings.filter((row) => row.targetSystem === 'ICD10').length,
    icd11Mappings: normalized.terminology_mappings.filter((row) => row.targetSystem === 'ICD11').length,
    snomedCtMappings: normalized.terminology_mappings.filter((row) => row.targetSystem === 'SNOMED_CT').length,
    omimMappings: normalized.terminology_mappings.filter((row) => row.targetSystem === 'OMIM').length,
  };

  console.log('[orphanet-build-initial-seed] artifact=' + outDir);
  console.log(JSON.stringify({ counts, normalizedCounts: result.normalizedCounts }, null, 2));
}

main().catch((error) => {
  console.error(`[orphanet-build-initial-seed] ${error.stack || error.message}`);
  process.exit(1);
});
