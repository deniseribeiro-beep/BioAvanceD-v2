/**
 * Offline hybrid crosswalk: MarkerDB provisional condition labels → governed ORPHA/MONDO
 * codings without removing provisional entries or evidence (#1206 / G1).
 */
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { MARKERDB_CONDITION_URI } = require('../../../models/BiomarkerAssociation');

const ORPHA_URI = 'http://www.orpha.net';
const MONDO_URI = 'http://purl.obolibrary.org/obo/mondo.owl';

const CROSSWALK_QUEUE_VERSION = '1.0.0';

function normalizeConditionLabel(label) {
  return String(label || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOrphaFromText(text) {
  const m = String(text || '').match(/\bORPHA[:\s]?(\d+)\b/i);
  return m ? `ORPHA:${m[1]}` : null;
}

function normalizeOrphaCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const m = raw.match(/^ORPHA:(\d+)$/i);
  if (m) return `ORPHA:${m[1]}`;
  if (/^\d+$/.test(raw)) return `ORPHA:${raw}`;
  return null;
}

function normalizeMondoCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const m = raw.match(/^MONDO:(\d+)$/i);
  if (m) return `MONDO:${m[1]}`;
  return null;
}

function codingKey(coding) {
  return `${coding.systemUri}::${String(coding.code).toLowerCase()}`;
}

function hasGovernedCondition(associatedCondition) {
  return (Array.isArray(associatedCondition) ? associatedCondition : []).some(
    (c) => c && (c.systemUri === ORPHA_URI || c.systemUri === MONDO_URI),
  );
}

function provisionalConditionEntries(associatedCondition) {
  return (Array.isArray(associatedCondition) ? associatedCondition : []).filter(
    (c) => c && c.systemUri === MARKERDB_CONDITION_URI,
  );
}

async function readJsonlFile(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function collectOrphaXrefs(raw) {
  const out = new Set();
  const xrefs = raw.xrefs;
  if (xrefs && typeof xrefs === 'object' && !Array.isArray(xrefs)) {
    const direct = normalizeOrphaCode(xrefs.orpha || xrefs.ORPHA);
    if (direct) out.add(direct);
  }
  if (Array.isArray(xrefs)) {
    for (const entry of xrefs) {
      const asOrpha = normalizeOrphaCode(entry);
      if (asOrpha) out.add(asOrpha);
      if (entry && typeof entry === 'object') {
        const nested = normalizeOrphaCode(entry.orpha || entry.id || entry.code);
        if (nested) out.add(nested);
      }
    }
  }
  return [...out];
}

/**
 * @param {Array<{ id, lbl, synonyms?, obsolete?, xrefs? }>} records
 */
function buildConditionLookupIndex(records, systemUri) {
  const byCode = new Map();
  /** @type {Map<string, Array<{ systemUri, code, display, method }>>} */
  const byNormalizedLabel = new Map();

  const isOrpha = systemUri === ORPHA_URI;
  const normalizeCode = isOrpha ? normalizeOrphaCode : normalizeMondoCode;

  for (const raw of records) {
    const code = normalizeCode(raw.id);
    const display = typeof raw.lbl === 'string' ? raw.lbl.trim() : '';
    if (!code || !display || raw.obsolete) continue;

    const concept = { systemUri, code, display };
    byCode.set(code, concept);

    const registerLabel = (text, method) => {
      const norm = normalizeConditionLabel(text);
      if (!norm) return;
      const bucket = byNormalizedLabel.get(norm) || [];
      if (!bucket.some((item) => item.systemUri === systemUri && item.code === code)) {
        bucket.push({ ...concept, method });
      }
      byNormalizedLabel.set(norm, bucket);
    };

    registerLabel(display, isOrpha ? 'exact_label_orpha' : 'exact_label_mondo');
    for (const syn of Array.isArray(raw.synonyms) ? raw.synonyms : []) {
      if (typeof syn === 'string' && syn.trim()) {
        registerLabel(syn, isOrpha ? 'alias_orpha' : 'alias_mondo');
      }
    }
  }

  return { byCode, byNormalizedLabel, systemUri };
}

function pickUniqueLabelMatch(bucket) {
  if (!Array.isArray(bucket) || bucket.length === 0) return null;
  const distinct = new Map();
  for (const item of bucket) {
    distinct.set(`${item.systemUri}::${item.code}`, item);
  }
  if (distinct.size !== 1) return null;
  return [...distinct.values()][0];
}

/**
 * Label-aligned ORPHA↔MONDO bridge plus explicit MONDO xrefs (never invented).
 */
function buildMondoToOrphaMap(orphaIndex, mondoRecords) {
  const map = new Map();
  const orphaPrimaryByNorm = new Map();

  for (const [code, concept] of orphaIndex.byCode) {
    const norm = normalizeConditionLabel(concept.display);
    if (!norm) continue;
    const existing = orphaPrimaryByNorm.get(norm);
    if (!existing) {
      orphaPrimaryByNorm.set(norm, code);
    } else if (existing !== code) {
      orphaPrimaryByNorm.set(norm, null);
    }
  }

  for (const raw of mondoRecords) {
    const mondoCode = normalizeMondoCode(raw.id);
    if (!mondoCode || raw.obsolete) continue;

    for (const orphaCode of collectOrphaXrefs(raw)) {
      if (orphaIndex.byCode.has(orphaCode)) {
        map.set(mondoCode, { orphaCode, method: 'mondo_xref' });
      }
    }

    const norm = normalizeConditionLabel(raw.lbl);
    const orphaCode = orphaPrimaryByNorm.get(norm);
    if (orphaCode && orphaIndex.byCode.has(orphaCode) && !map.has(mondoCode)) {
      map.set(mondoCode, { orphaCode, method: 'mondo_label_orpha' });
    }
  }

  return map;
}

function matchProvisionalLabel(label, indices, mondoToOrpha) {
  const text = String(label || '').trim();
  if (!text) return { matches: [], method: null };

  const matches = [];
  const addMatch = (coding, method) => {
    const key = codingKey(coding);
    if (matches.some((m) => codingKey(m.coding) === key)) return;
    matches.push({ coding, method });
  };

  const parsedOrpha = extractOrphaFromText(text);
  if (parsedOrpha && indices.orpha.byCode.has(parsedOrpha)) {
    const concept = indices.orpha.byCode.get(parsedOrpha);
    addMatch(
      { systemUri: ORPHA_URI, code: concept.code, display: concept.display },
      'parsed_orpha',
    );
    return { matches, method: 'parsed_orpha' };
  }

  const norm = normalizeConditionLabel(text);
  const orphaBucket = (indices.orpha.byNormalizedLabel.get(norm) || [])
    .filter((item) => item.systemUri === ORPHA_URI);
  const orphaExact = orphaBucket.find((item) => item.method === 'exact_label_orpha')
    || pickUniqueLabelMatch(orphaBucket.filter((item) => item.method === 'exact_label_orpha'));
  if (orphaExact) {
    addMatch(
      { systemUri: ORPHA_URI, code: orphaExact.code, display: orphaExact.display },
      orphaExact.method,
    );
  } else {
    const orphaAlias = orphaBucket.find((item) => item.method === 'alias_orpha');
    if (orphaAlias) {
      addMatch(
        { systemUri: ORPHA_URI, code: orphaAlias.code, display: orphaAlias.display },
        'alias_orpha',
      );
    }
  }

  if (matches.some((m) => m.coding.systemUri === ORPHA_URI)) {
    return { matches, method: matches[0].method };
  }

  const mondoBucket = (indices.mondo.byNormalizedLabel.get(norm) || [])
    .filter((item) => item.systemUri === MONDO_URI);
  const mondoPick = mondoBucket.find((item) => item.method === 'exact_label_mondo')
    || pickUniqueLabelMatch(mondoBucket)
    || mondoBucket.find((item) => item.method === 'alias_mondo');

  if (mondoPick) {
    addMatch(
      { systemUri: MONDO_URI, code: mondoPick.code, display: mondoPick.display },
      mondoPick.method,
    );
    const bridge = mondoToOrpha.get(mondoPick.code);
    if (bridge && indices.orpha.byCode.has(bridge.orphaCode)) {
      const orpha = indices.orpha.byCode.get(bridge.orphaCode);
      addMatch(
        { systemUri: ORPHA_URI, code: orpha.code, display: orpha.display },
        bridge.method,
      );
    }
  }

  return {
    matches,
    method: matches.length ? matches[matches.length - 1].method : null,
  };
}

function mergeConditionCodings(existing, additions) {
  const merged = [...(Array.isArray(existing) ? existing : [])];
  const seen = new Set(merged.filter(Boolean).map(codingKey));
  for (const coding of additions) {
    if (!coding || !coding.systemUri || !coding.code) continue;
    const key = codingKey(coding);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(coding);
  }
  return merged;
}

/**
 * @param {object[]} records — BiomarkerAssociation JSONL rows
 */
function crosswalkAssociationRecords(records, indices, mondoToOrpha) {
  const enriched = [];
  const unmatched = [];
  let provisionalRows = 0;
  let mappedRows = 0;
  let alreadyGoverned = 0;

  for (const record of records) {
    const conditions = Array.isArray(record.associatedCondition) ? record.associatedCondition : [];
    const provisionals = provisionalConditionEntries(conditions);

    if (provisionals.length === 0) {
      if (hasGovernedCondition(conditions)) alreadyGoverned += 1;
      enriched.push(record);
      continue;
    }

    provisionalRows += 1;
    const additions = [];
    const matchMethods = [];
    let anyMatch = false;

    for (const prov of provisionals) {
      const { matches, method } = matchProvisionalLabel(prov.display || prov.code, indices, mondoToOrpha);
      if (matches.length) {
        anyMatch = true;
        for (const m of matches) additions.push(m.coding);
        if (method) matchMethods.push(method);
      } else {
        unmatched.push({
          queueVersion: CROSSWALK_QUEUE_VERSION,
          biomarkerId: record.biomarkerId || null,
          provisionalDisplay: prov.display || null,
          provisionalCode: prov.code || null,
          reason: 'no_match',
          attemptedMethods: ['parsed_orpha', 'exact_label_orpha', 'alias_orpha', 'exact_label_mondo', 'alias_mondo', 'mondo_to_orpha'],
        });
      }
    }

    if (anyMatch) mappedRows += 1;

    enriched.push({
      ...record,
      associatedCondition: mergeConditionCodings(conditions, additions),
      ...(matchMethods.length ? { crosswalkMatchMethods: [...new Set(matchMethods)] } : {}),
    });
  }

  const pctMapped = provisionalRows > 0
    ? Math.round((mappedRows / provisionalRows) * 10000) / 100
    : 100;

  return {
    enriched,
    unmatched,
    summary: {
      recordsRead: records.length,
      provisionalRows,
      mappedRows,
      unmatchedRows: provisionalRows - mappedRows,
      alreadyGoverned,
      pctProvisionalMapped: pctMapped,
    },
  };
}

async function loadJsonlTerminologyIndex(orphaJsonlPath, mondoJsonlPath) {
  const [orphaRecords, mondoRecords] = await Promise.all([
    readJsonlFile(orphaJsonlPath),
    readJsonlFile(mondoJsonlPath),
  ]);
  const orpha = buildConditionLookupIndex(orphaRecords, ORPHA_URI);
  const mondo = buildConditionLookupIndex(mondoRecords, MONDO_URI);
  const mondoToOrpha = buildMondoToOrphaMap(orpha, mondoRecords);
  return { orpha, mondo, mondoToOrpha, orphaRecords, mondoRecords };
}

async function loadMongoTerminologyIndex(db) {
  const coll = db.collection('terminologyConcepts');
  const cursor = coll.find(
    {
      systemUri: { $in: [ORPHA_URI, MONDO_URI] },
      conceptStatus: { $ne: 'obsolete' },
    },
    { projection: { systemUri: 1, code: 1, display: 1, synonyms: 1 } },
  );

  const orphaRecords = [];
  const mondoRecords = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    const synonyms = Array.isArray(doc.synonyms)
      ? doc.synonyms.map((s) => (typeof s === 'string' ? s : s.term)).filter(Boolean)
      : [];
    const row = {
      id: doc.code,
      lbl: doc.display,
      synonyms,
      obsolete: false,
    };
    if (doc.systemUri === ORPHA_URI) orphaRecords.push(row);
    else if (doc.systemUri === MONDO_URI) mondoRecords.push(row);
  }

  const orpha = buildConditionLookupIndex(orphaRecords, ORPHA_URI);
  const mondo = buildConditionLookupIndex(mondoRecords, MONDO_URI);
  const mondoToOrpha = buildMondoToOrphaMap(orpha, mondoRecords);
  return { orpha, mondo, mondoToOrpha };
}

function defaultRepoRoot() {
  return path.resolve(__dirname, '../../../../../../..');
}

function writeJsonl(filePath, rows) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const body = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  fs.writeFileSync(filePath, body, 'utf8');
}

module.exports = {
  ORPHA_URI,
  MONDO_URI,
  CROSSWALK_QUEUE_VERSION,
  normalizeConditionLabel,
  extractOrphaFromText,
  buildConditionLookupIndex,
  buildMondoToOrphaMap,
  matchProvisionalLabel,
  mergeConditionCodings,
  crosswalkAssociationRecords,
  loadJsonlTerminologyIndex,
  loadMongoTerminologyIndex,
  readJsonlFile,
  writeJsonl,
  defaultRepoRoot,
  MARKERDB_CONDITION_URI,
};