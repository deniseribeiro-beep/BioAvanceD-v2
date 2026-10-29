const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const yauzl = require('yauzl');

/**
 * Lab converter: Orphanet Nomenclature Pack EN zip →
 *   1) data.jsonl — RF028 { id, lbl, is_a[], synonyms[], obsolete }
 *   2) intake-records.jsonl — terminologySync / orphanet_diseases shape with
 *      relacoes.{orpha,omim,cid,cid10} from ORPHA_OMIM + ORPHA_ICD10 mappings
 *
 * Intake wizard disease search reads terminologies/orphanet_diseases.relacoes
 * to autofill ORPHA + OMIM + CID-10 — Orphadata is the unified crosswalk
 * (no separate OMIM dump required for that autofill path).
 */

const PACK_PREFIX = 'Orphanet_Nomenclature_Pack_EN/';
const NOMENCLATURE = `${PACK_PREFIX}ORPHAnomenclature_en_2026.xml`;
const OMIM_MAP = `${PACK_PREFIX}ORPHA_OMIM_mapping_en_2026.xml`;
const ICD10_MAP = `${PACK_PREFIX}ORPHA_ICD10_mapping_en_2026.xml`;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (typeof node === 'object' && node['#text'] != null) return String(node['#text']).trim();
  return '';
}

function mappingRank(relationName) {
  const name = String(relationName || '');
  if (/\bE\b|\bExact\b/i.test(name)) return 0;
  if (/\bBTNT\b/i.test(name)) return 1;
  if (/\bNTBT\b/i.test(name)) return 2;
  if (/\bND\b/i.test(name)) return 3;
  return 4;
}

function pickBestReference(refs, sourceName) {
  const matches = refs.filter((ref) => String(ref.Source || '').toUpperCase().includes(sourceName));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const ra = mappingRank(textOf(a.DisorderMappingRelation && a.DisorderMappingRelation.Name));
    const rb = mappingRank(textOf(b.DisorderMappingRelation && b.DisorderMappingRelation.Name));
    if (ra !== rb) return ra - rb;
    return String(a.Reference || '').localeCompare(String(b.Reference || ''));
  });
  return String(matches[0].Reference || '').trim() || null;
}

function parseDisorderList(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    trimValues: true,
  });
  const doc = parser.parse(xml);
  return asArray(doc?.JDBOR?.DisorderList?.Disorder);
}

function indexExternalMappings(xml, sourceName) {
  const byOrpha = new Map();
  for (const disorder of parseDisorderList(xml)) {
    const orpha = textOf(disorder.OrphaCode);
    if (!orpha) continue;
    const refs = asArray(disorder.ExternalReferenceList?.ExternalReference);
    const code = pickBestReference(refs, sourceName);
    if (!code) continue;
    const relation = textOf(refs.find((r) => String(r.Source || '').toUpperCase().includes(sourceName))
      ?.DisorderMappingRelation?.Name);
    byOrpha.set(orpha, { code, relation });
  }
  return byOrpha;
}

function buildRecords({ nomenclatureXml, omimXml, icd10Xml }) {
  const omimByOrpha = indexExternalMappings(omimXml, 'OMIM');
  const icd10ByOrpha = indexExternalMappings(icd10Xml, 'ICD-10');
  const jsonl = [];
  const intake = [];

  for (const disorder of parseDisorderList(nomenclatureXml)) {
    const orphaNumeric = textOf(disorder.OrphaCode);
    if (!orphaNumeric) continue;
    const id = `ORPHA:${orphaNumeric}`;
    const lbl = textOf(disorder.Name);
    const synonyms = asArray(disorder.SynonymList?.Synonym).map(textOf).filter(Boolean);
    const status = textOf(disorder.Totalstatus).toLowerCase();
    const obsolete = status && status !== 'active';
    if (!lbl) continue;

    jsonl.push({
      id,
      lbl,
      is_a: [],
      synonyms,
      obsolete,
    });

    const omim = omimByOrpha.get(orphaNumeric);
    const icd10 = icd10ByOrpha.get(orphaNumeric);
    const cid = icd10?.code || '';
    const omimCode = omim?.code ? `OMIM:${omim.code}` : '';

    intake.push({
      sistema: 'ORPHA',
      codigo: orphaNumeric,
      ORPHA: orphaNumeric,
      ORPHAcode: orphaNumeric,
      orphaCode: id,
      descricao: lbl,
      label: lbl,
      sinonimos: synonyms,
      aliases: synonyms,
      OMIM: omimCode,
      Codigos_CID10: cid,
      relacoes: {
        orpha: id,
        omim: omimCode,
        cid,
        cid10: cid,
        omimMapping: omim?.relation || '',
        cid10Mapping: icd10?.relation || '',
      },
      ativo: !obsolete,
      fonte: 'orphadata-nomenclature-pack',
    });
  }

  return { jsonl, intake };
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'w');
  try {
    for (const record of records) fs.writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let found = false;
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName !== entryName) {
          zipfile.readEntry();
          return;
        }
        found = true;
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(streamErr);
          const chunks = [];
          readStream.on('data', (c) => chunks.push(c));
          readStream.on('end', () => {
            zipfile.close();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          readStream.on('error', reject);
        });
      });
      zipfile.on('end', () => {
        if (!found) reject(new Error(`Zip entry ausente: ${entryName}`));
      });
      zipfile.on('error', reject);
    });
  });
}

async function convertOrphaPackFile({ inputPath, outputPath, intakeOutputPath }) {
  const [nomenclatureXml, omimXml, icd10Xml] = await Promise.all([
    readZipEntry(inputPath, NOMENCLATURE),
    readZipEntry(inputPath, OMIM_MAP),
    readZipEntry(inputPath, ICD10_MAP),
  ]);
  const { jsonl, intake } = buildRecords({ nomenclatureXml, omimXml, icd10Xml });
  writeJsonl(outputPath, jsonl);
  const intakePath = intakeOutputPath || path.join(path.dirname(outputPath), 'intake-records.jsonl');
  writeJsonl(intakePath, intake);
  return {
    recordCount: jsonl.length,
    intakeRecordCount: intake.length,
    withOmim: intake.filter((r) => r.relacoes.omim).length,
    withCid10: intake.filter((r) => r.relacoes.cid10).length,
    outputPath,
    intakeOutputPath: intakePath,
  };
}

async function main(argv = process.argv.slice(2)) {
  let inputPath = null;
  let outputPath = null;
  let intakeOutputPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') inputPath = argv[++i];
    else if (argv[i] === '--out') outputPath = argv[++i];
    else if (argv[i] === '--intake-out') intakeOutputPath = argv[++i];
  }
  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: convertOrphaPackToJsonl.js --in <pack.zip> --out <data.jsonl> [--intake-out <intake-records.jsonl>]\n');
    process.exit(2);
  }
  const result = await convertOrphaPackFile({ inputPath, outputPath, intakeOutputPath });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  mappingRank,
  pickBestReference,
  buildRecords,
  convertOrphaPackFile,
  textOf,
  asArray,
};
