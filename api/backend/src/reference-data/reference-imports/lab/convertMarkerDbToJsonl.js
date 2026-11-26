#!/usr/bin/env node
/**
 * Lab converter: MarkerDB Downloads (TSV + XML) → BiomarkerAssociation JSONL.
 * No network. Staging: docs/data/markerdb/2024-09-12/
 *
 *   node convertMarkerDbToJsonl.js --in <file.tsv|file.xml> --out <out.jsonl>
 *   node convertMarkerDbToJsonl.js --dir <markerdb-dir> --out <out.jsonl>
 *
 * XML is authoritative when both exist; TSV is fallback/lab.
 * Rows without condition label or without DOI/PMID are skipped (#1206).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MARKERDB_CONDITION_URI } = require('../../../models/BiomarkerAssociation');

const ORPHA_URI = 'http://www.orpha.net';
const HGNC_URI = 'https://www.genenames.org';
const UNIPROT_URI = 'https://www.uniprot.org/uniprot';
const HMDB_URI = 'https://hmdb.ca';
const DBSNP_URI = 'https://www.ncbi.nlm.nih.gov/snp/';
const ISCN_URI = 'https://markerdb.ca/karyotype';

function parseArgs(argv) {
  const args = { inPath: null, outPath: null, dirPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') args.inPath = argv[++i];
    if (argv[i] === '--out') args.outPath = argv[++i];
    if (argv[i] === '--dir') args.dirPath = argv[++i];
  }
  return args;
}

function splitTsv(line) {
  return line.split('\t').map((c) => c.trim());
}

function extractOrpha(text) {
  const m = String(text || '').match(/ORPHA[:\s]?(\d+)/i);
  return m ? `ORPHA:${m[1]}` : null;
}

function extractPmid(text) {
  const raw = String(text || '');
  const labeled = raw.match(/\bPMID[:\s]?(\d{1,9})\b/i);
  if (labeled) return labeled[1];
  // Genetics dumps use bare PMIDs separated by ';'
  const bareList = raw.match(/\b([1-9]\d{6,8})\b/g);
  if (bareList && bareList.length) return bareList[0];
  return null;
}

function extractDoi(text) {
  const m = String(text || '').match(/\b(10\.\d{4,9}\/[^\s;]+)/i);
  return m ? m[1].replace(/[.,);]+$/, '') : null;
}

function stableId(parts) {
  return `ba-mdb-${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)}`;
}

function slugCondition(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'unknown';
}

function mapRole(indication) {
  const t = String(indication || '').toLowerCase();
  if (t.includes('risk')) return 'risk';
  if (t.includes('progn')) return 'prognostic';
  if (t.includes('monitor')) return 'monitoring';
  if (t.includes('safety') || t.includes('exposure')) return 'safety';
  if (t.includes('response')) return 'response';
  return 'diagnostic';
}

function conditionCoding(condRaw) {
  const label = String(condRaw || '').trim();
  if (!label || /^normal$/i.test(label) || label === 'NA') return null;
  const orpha = extractOrpha(label);
  if (orpha) {
    return { systemUri: ORPHA_URI, code: orpha, display: label.slice(0, 200) };
  }
  return {
    systemUri: MARKERDB_CONDITION_URI,
    code: slugCondition(label),
    display: label.slice(0, 200),
  };
}

function evidenceFromText(text) {
  const doi = extractDoi(text);
  if (doi) return [{ system: 'DOI', value: doi }];
  const pmid = extractPmid(text);
  if (pmid) return [{ system: 'PMID', value: String(pmid) }];
  return [];
}

function buildRecord({
  analyte, conditionLabel, indication, citation, biofluid, concentration, age, sex, sourceDataset,
}) {
  const condition = conditionCoding(conditionLabel);
  const evidence = evidenceFromText(citation);
  if (!condition || !analyte || evidence.length === 0) return null;
  const role = mapRole(indication);
  const contextParts = [
    `MarkerDB ${sourceDataset || 'dump'}`,
    condition.display,
    biofluid ? `biofluid=${biofluid}` : null,
    age ? `age=${age}` : null,
    sex ? `sex=${sex}` : null,
  ].filter(Boolean);
  const biomarkerId = stableId([
    analyte.systemUri, analyte.code, condition.systemUri, condition.code, evidence[0].value, role,
  ]);
  return {
    biomarkerId,
    analyte,
    associatedCondition: [condition],
    biospecimenMatrix: biofluid
      ? { systemUri: 'https://markerdb.ca/biofluid', code: slugCondition(biofluid), display: biofluid }
      : null,
    biomarkerRole: role,
    contextOfUse: contextParts.join('; '),
    cutoff: concentration ? { text: String(concentration).slice(0, 120) } : null,
    evidenceReferences: evidence,
    sourceId: 'SRC_MARKERDB',
    sourceDataset: sourceDataset || null,
  };
}

function analyteFromTsvRow(cols, header, sourceDataset) {
  const idx = (names) => names.reduce((found, n) => (found >= 0 ? found : header.indexOf(n)), -1);
  const iName = idx(['name', 'marker_name', 'biomarker', 'protein_name', 'chemical_name']);
  const iGene = idx(['gene', 'gene_name', 'gene_symbol', 'hgnc_symbol']);
  const iUniprot = idx(['uniprot_id', 'uniprot']);
  const iHmdb = idx(['hmdb_id', 'hmdb']);
  const iVar = idx(['variation', 'variant', 'rsid']);
  const iKaryo = idx(['karyotype']);
  const display = (iName >= 0 ? cols[iName] : '') || (iVar >= 0 ? cols[iVar] : '') || (iKaryo >= 0 ? cols[iKaryo] : '');
  if (iVar >= 0 && cols[iVar]) {
    const rs = String(cols[iVar]).trim();
    return { systemUri: DBSNP_URI, code: rs, display: rs };
  }
  if (iKaryo >= 0 && cols[iKaryo]) {
    const k = String(cols[iKaryo]).trim();
    return { systemUri: ISCN_URI, code: slugCondition(k), display: k };
  }
  if (iUniprot >= 0 && cols[iUniprot]) {
    return { systemUri: UNIPROT_URI, code: cols[iUniprot], display: display || cols[iUniprot] };
  }
  if (iHmdb >= 0 && cols[iHmdb]) {
    return { systemUri: HMDB_URI, code: cols[iHmdb], display: display || cols[iHmdb] };
  }
  if (iGene >= 0 && cols[iGene]) {
    return { systemUri: HGNC_URI, code: `SYMBOL:${cols[iGene]}`, display: cols[iGene] };
  }
  if (!display) return null;
  return { systemUri: 'https://markerdb.ca/marker', code: slugCondition(display), display };
}

/**
 * @param {string[]} lines raw TSV including header
 * @param {{ sourceDataset?: string }} [opts]
 */
function convertMarkerDbTsvLines(lines, opts = {}) {
  if (!lines.length) return [];
  const header = splitTsv(lines[0]).map((h) => h.toLowerCase());
  const idx = (names) => names.reduce((found, n) => (found >= 0 ? found : header.indexOf(n)), -1);
  const iCond = idx(['condition', 'conditions', 'disease', 'associated_conditions']);
  const iRef = idx(['reference', 'references', 'pmid', 'citation']);
  const iInd = idx(['indication_types', 'indication_type', 'indication']);
  const iFluid = idx(['biofluid']);
  const iConc = idx(['concentration']);
  const iAge = idx(['age']);
  const iSex = idx(['sex']);
  if (iCond < 0) {
    throw new Error('MarkerDB TSV sem coluna conditions');
  }

  const out = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cols = splitTsv(lines[i]);
    const analyte = analyteFromTsvRow(cols, header, opts.sourceDataset);
    const citation = iRef >= 0 ? cols[iRef] : '';
    const rec = buildRecord({
      analyte,
      conditionLabel: cols[iCond],
      indication: iInd >= 0 ? cols[iInd] : '',
      citation,
      biofluid: iFluid >= 0 ? cols[iFluid] : '',
      concentration: iConc >= 0 ? cols[iConc] : '',
      age: iAge >= 0 ? cols[iAge] : '',
      sex: iSex >= 0 ? cols[iSex] : '',
      sourceDataset: opts.sourceDataset,
    });
    if (!rec || seen.has(rec.biomarkerId)) continue;
    seen.add(rec.biomarkerId);
    out.push(rec);
  }
  return out;
}

function stripTag(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() : '';
}

/**
 * Minimal XML converter for MarkerDB protein/chemical style trees.
 * Falls back to empty if structure unexpected — TSV remains lab fallback.
 */
function convertMarkerDbXml(xmlText, sourceDataset = 'xml') {
  const out = [];
  const seen = new Set();
  const blocks = String(xmlText).split(/<(?:protein|chemical|sequence_variant|karyotype|marker)\b/i).slice(1);
  for (const block of blocks) {
    const chunk = `<x${block}`;
    const name = stripTag(chunk, 'name') || stripTag(chunk, 'variation') || stripTag(chunk, 'karyotype');
    const gene = stripTag(chunk, 'gene_name') || stripTag(chunk, 'gene_symbol');
    const uniprot = stripTag(chunk, 'uniprot_id');
    const hmdb = stripTag(chunk, 'hmdb_id');
    const variation = stripTag(chunk, 'variation');
    const karyotype = stripTag(chunk, 'karyotype');
    let analyte = null;
    if (variation) analyte = { systemUri: DBSNP_URI, code: variation, display: variation };
    else if (karyotype) analyte = { systemUri: ISCN_URI, code: slugCondition(karyotype), display: karyotype };
    else if (uniprot) analyte = { systemUri: UNIPROT_URI, code: uniprot, display: name || uniprot };
    else if (hmdb) analyte = { systemUri: HMDB_URI, code: hmdb, display: name || hmdb };
    else if (gene) analyte = { systemUri: HGNC_URI, code: `SYMBOL:${gene}`, display: gene };
    else if (name) analyte = { systemUri: 'https://markerdb.ca/marker', code: slugCondition(name), display: name };
    if (!analyte) continue;

    const conditionBlocks = chunk.split(/<condition>/i).slice(1);
    const targets = conditionBlocks.length ? conditionBlocks : [chunk];
    for (const cb of targets) {
      const conditionLabel = stripTag(`<c>${cb}`, 'condition') || stripTag(chunk, 'conditions');
      const citation = stripTag(`<c>${cb}`, 'citation') || stripTag(chunk, 'reference') || stripTag(chunk, 'citation');
      const indication = stripTag(`<c>${cb}`, 'indication_type') || stripTag(chunk, 'indication_types');
      const biofluid = stripTag(`<c>${cb}`, 'biofluid');
      const concentration = stripTag(`<c>${cb}`, 'concentration');
      const age = stripTag(`<c>${cb}`, 'age');
      const sex = stripTag(`<c>${cb}`, 'sex');
      const rec = buildRecord({
        analyte,
        conditionLabel: conditionLabel || stripTag(chunk, 'conditions'),
        indication,
        citation,
        biofluid,
        concentration,
        age,
        sex,
        sourceDataset,
      });
      if (!rec || seen.has(rec.biomarkerId)) continue;
      seen.add(rec.biomarkerId);
      out.push(rec);
    }
  }
  return out;
}

function convertFile(filePath) {
  const base = path.basename(filePath);
  const sourceDataset = base.replace(/\.(tsv|xml)$/i, '');
  const raw = fs.readFileSync(filePath, 'utf8');
  if (/\.xml$/i.test(filePath)) {
    return convertMarkerDbXml(raw, sourceDataset);
  }
  return convertMarkerDbTsvLines(raw.split(/\r?\n/), { sourceDataset });
}

function convertDirectory(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter((f) => /\.(tsv|xml)$/i.test(f))
    .sort();
  // Prefer TSV when both exist: MarkerDB XML nests a disease <condition>
  // inside a measurement <condition> block; the XML path truncated labels to
  // the outer blob (slice 200). TSV `conditions` column is the clean disease name.
  const byStem = new Map();
  for (const f of files) {
    const stem = f.replace(/\.(tsv|xml)$/i, '');
    const ext = /\.xml$/i.test(f) ? 'xml' : 'tsv';
    const cur = byStem.get(stem) || {};
    cur[ext] = path.join(dirPath, f);
    byStem.set(stem, cur);
  }
  const seen = new Set();
  const out = [];
  for (const [, paths] of byStem) {
    const chosen = paths.tsv || paths.xml;
    for (const rec of convertFile(chosen)) {
      if (seen.has(rec.biomarkerId)) continue;
      seen.add(rec.biomarkerId);
      out.push(rec);
    }
  }
  return out;
}

function writeJsonl(records, outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, `${records.map((r) => JSON.stringify(r)).join('\n')}${records.length ? '\n' : ''}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.outPath || (!args.inPath && !args.dirPath)) {
    process.stderr.write('Usage: convertMarkerDbToJsonl.js (--in <tsv|xml> | --dir <dir>) --out <jsonl>\n');
    process.exit(2);
  }
  const records = args.dirPath
    ? convertDirectory(path.resolve(args.dirPath))
    : convertFile(path.resolve(args.inPath));
  const outAbs = path.resolve(args.outPath);
  writeJsonl(records, outAbs);
  process.stdout.write(`${JSON.stringify({ records: records.length, outPath: outAbs })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}

module.exports = {
  convertMarkerDbTsvLines,
  convertMarkerDbXml,
  convertFile,
  convertDirectory,
  extractOrpha,
  extractPmid,
  extractDoi,
  MARKERDB_CONDITION_URI,
};
