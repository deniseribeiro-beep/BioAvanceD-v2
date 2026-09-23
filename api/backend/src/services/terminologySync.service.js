const crypto = require('crypto');
const Terminology = require('../models/Terminology');
const logger = require('../utils/logger');
const { dropLegacyIndex } = require('../utils/legacyIndex');

const DEFAULT_TIMEOUT_MS = 15000;
const ORPHADATA_BASE_URL = process.env.ORPHADATA_BASE_URL || '';

// #941: `Terminology.js:44` declares `{ sistema: 1, codigo: 1 }, { unique:
// true }`, but the mongoose connection opens with `autoIndex: false`
// (connection.js:26) and nothing calls `syncIndexes()`/`createIndexes()`
// anywhere, so that declaration never reaches Mongo. Two independent
// writers upsert into `terminologies` keyed on the same `{ sistema,
// codigo }` pair -- this file's own `upsertTerminology` (native db path,
// reached via `syncFromOrphadata`) and
// `terminologies.routes.js` (`bulkUpsertTerminologies`) -- so the pair
// races with no database-level protection. This is the native-driver
// equivalent, latched per collection name like `cid.service.js`'s
// `ensureIndexes`. BOTH writers call it; the original fix wired only the
// first, which is the env-gated one, so the index was not built on the
// default offline path at all.
//
// A `partialFilterExpression` IS required, and the `_v1` index that shipped
// without one was broken. The reasoning it replaced said "both writers
// already guard `sistema`/`codigo` as non-empty truthy strings", which is
// true of the two writers named above and false of the collection: there is
// a THIRD writer nobody counted.
//
// `scripts/seed-essential-reference-data.js`'s `sprec-minimal` entry
// (`npm run seed:essential`, manifest key `sprec-minimal`, business key
// `['sistema','fonte','axis','code']`) upserts the four SPREC axis rows into
// `terminologies` shaped `{ sistema:'SPREC', fonte, axis, code, label,
// descricao }`. They carry `code`, never `codigo`. Under a plain unique
// index Mongo reads the missing field as null, so all four share the key
// `{ 'SPREC', null }` and collide with one another -- the exact
// explicit-null analogue the old comment concluded did not exist.
//
// It failed silently in both orderings, which is why nothing caught it:
// seed-then-index makes `createIndex` throw E11000, which the catch below
// logs as a warning and then latches anyway, so the index never exists and
// never retries; index-then-seed fails the seed run instead.
//
// `$type: 'string'` rather than `$exists: true` because a null or numeric
// `codigo` would collide the same way. Both real writers emit strings and
// screen falsy values, so nothing legitimate is excluded -- the two writers
// the old comment reasoned about are still fully covered.
const indexedTerminologyCollections = new Set();

async function ensureTerminologyIndexes(collection, collectionName = 'terminologies') {
  if (!collection || typeof collection.createIndex !== 'function' || !collectionName) return;
  if (indexedTerminologyCollections.has(collectionName)) return;

  // #1164: `$gt: ''`, not `$type: 'string'`. Both keep missing/null rows
  // out (comparisons are type-bracketed, so `$gt: ''` means "a non-empty
  // string"), but the planner cannot prove a plain equality implies a
  // `$type` filter, so the `$type` version enforced uniqueness while never
  // serving a single lookup. The new name is built FIRST, then the
  // superseded one dropped, so the constraint never has a gap.
  // Here that lookup is the sync upsert's own `{ sistema, codigo }` filter,
  // run once per synced record.
  try {
    await collection.createIndex(
      { sistema: 1, codigo: 1 },
      {
        name: 'terminologies_sistema_codigo_unique_v3',
        unique: true,
        partialFilterExpression: { sistema: { $gt: '' }, codigo: { $gt: '' } },
      }
    );
    // Only once the replacement exists: a failed build keeps the old constraint.
    await dropLegacyIndex(collection, 'terminologies_sistema_codigo_unique_v2', 'TERMINOLOGIES');
  } catch (error) {
    logger.warn(`Não foi possível criar índice terminologies_sistema_codigo_unique_v3 em ${collectionName}: ${error.message}`);
  }

  indexedTerminologyCollections.add(collectionName);
}

function isExternalTerminologySyncEnabled() {
  const raw = String(process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC || process.env.ALLOW_CLOUD_INTEGRATIONS || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOrphaCode(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return /^ORPHA:/i.test(raw) ? raw.replace(/^orpha:/i, 'ORPHA:') : `ORPHA:${raw}`;
}

function normalizeOmimCode(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  return /^OMIM:/i.test(raw) ? raw.replace(/^omim:/i, 'OMIM:') : `OMIM:${raw}`;
}

function normalizeReferenceList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

function findExternalReference(record = {}, source) {
  const externalReferences = normalizeReferenceList(
    record.ExternalReference
    || record.externalReferences
    || record.externalReference
  );
  const found = externalReferences.find((entry) => String(entry?.Source || entry?.source || '').toUpperCase() === source);
  return normalizeText(found?.Reference || found?.reference || found?.code || found?.id || found?.value);
}

function getOrphaNumeric(value) {
  const normalized = normalizeOrphaCode(value);
  return normalized ? normalized.replace(/^ORPHA:/i, '') : '';
}

function computeHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function normalizeRecord(record = {}, fallbackSystem = 'OUTRO') {
  const codigo = normalizeText(
    record.codigo ||
    record.code ||
    record.id ||
    record.ORPHAcode ||
    record.orphaCode ||
    record.ORPHA ||
    record.OMIM ||
    record.hpoId ||
    record.cid ||
    record.cid10 ||
    record.codigo_tabulacao ||
    record.Codigo_Tabulacao
  );

  const sistema = normalizeText(
    record.sistema ||
    record.system ||
    record.source ||
    record.tipo ||
    (record.ORPHAcode || record.orphaCode ? 'ORPHA' : '') ||
    fallbackSystem
  ).toUpperCase();

  let normalizedCodigo = codigo;
  if (sistema === 'ORPHA') {
    normalizedCodigo = normalizeOrphaCode(codigo || record.ORPHA || record.orpha || record.ORPHAcode || record.orphaCode);
  } else if (sistema === 'OMIM') {
    normalizedCodigo = normalizeOmimCode(codigo || record.OMIM || record.omim || record.omimCode);
  }

  const descricaoRaw = normalizeText(
    record.descricao ||
    record.description ||
    record['Preferred term'] ||
    record.label ||
    record.name ||
    record.title ||
    record.Descricao
  );
  const descricao = descricaoRaw || normalizedCodigo || codigo;

  const sinonimos = Array.isArray(record.sinonimos)
    ? record.sinonimos.map(normalizeText).filter(Boolean)
    : Array.isArray(record.synonyms)
      ? record.synonyms.map(normalizeText).filter(Boolean)
      : Array.isArray(record.Synonym)
        ? record.Synonym.map((item) => normalizeText(item?.label || item?.Label || item?._ || item)).filter(Boolean)
      : [];

  const aliases = Array.isArray(record.aliases)
    ? record.aliases.map(normalizeText).filter(Boolean)
    : [];

  const relacoes = {
    cid: normalizeText(record.cid || record.cid10 || record.Codigos_CID10 || record.ICD10 || record.icdCode),
    hpo: normalizeText(record.hpo || record.hpoId),
    omim: normalizeOmimCode(record.omim || record.OMIM || record.omimCode),
    orpha: normalizeOrphaCode(record.orpha || record.ORPHA || record.orphaCode || record.ORPHAcode),
  };

  if (!relacoes.cid) {
    relacoes.cid = findExternalReference(record, 'ICD-10');
  }
  if (!relacoes.omim) {
    relacoes.omim = normalizeOmimCode(findExternalReference(record, 'OMIM'));
  }
  if (!relacoes.orpha) {
    relacoes.orpha = normalizeOrphaCode(record.ORPHAcode || record.orphaCode || record.ORPHA || record.orpha || normalizedCodigo || codigo);
  }
  relacoes.cid10 = relacoes.cid;

  const normalized = {
    codigo: normalizedCodigo || codigo,
    sistema,
    descricao,
    label: normalizeText(record.label || record.name || descricao || normalizedCodigo || codigo),
    sinonimos,
    aliases,
    relacoes,
    ativo: record.ativo !== undefined ? Boolean(record.ativo) : true,
    fonte: normalizeText(record.fonte || 'orphadata') || 'orphadata',
  };

  normalized.hashConteudo = computeHash(normalized);
  normalized.sincronizadoEm = new Date();
  normalized.updatedAt = new Date();

  return normalized;
}

async function upsertOrphanetRedundancy(db, payload) {
  if (!db || typeof db.collection !== 'function') return;
  if (String(payload?.sistema || '').toUpperCase() !== 'ORPHA') return;

  const code = getOrphaNumeric(payload.codigo);
  if (!code) return;

  const cid = normalizeText(payload.relacoes?.cid10 || payload.relacoes?.cid || payload.Codigos_CID10);
  const omim = normalizeOmimCode(payload.relacoes?.omim || payload.OMIM);
  const name = normalizeText(payload.descricao || payload.label || payload.codigo);
  const aliases = Array.from(new Set([
    ...(Array.isArray(payload.aliases) ? payload.aliases : []),
    ...(Array.isArray(payload.sinonimos) ? payload.sinonimos : []),
  ].map((item) => normalizeText(item)).filter(Boolean)));

  await db.collection('orphanet_diseases').updateOne(
    { code },
    {
      $set: {
        code,
        orphaCode: normalizeOrphaCode(code),
        ORPHA: code,
        ORPHAcode: code,
        name,
        label: name,
        description: name,
        Codigos_CID10: cid,
        OMIM: omim,
        synonyms: aliases,
        aliases,
        relacoes: {
          cid,
          cid10: cid,
          omim,
          orpha: normalizeOrphaCode(code),
        },
        lang: 'pt',
        source: 'terminology-sync',
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function upsertTerminology(record, db = null) {
  const payload = normalizeRecord(record, record.sistema);

  if (!payload.codigo || !payload.sistema || !payload.descricao) {
    return { skipped: true, reason: 'missing-required-fields' };
  }

  let result;
  if (db && typeof db.collection === 'function') {
    const terminologiesCollection = db.collection('terminologies');
    await ensureTerminologyIndexes(terminologiesCollection, 'terminologies');
    await terminologiesCollection.updateOne(
      { sistema: payload.sistema, codigo: payload.codigo },
      { $set: payload },
      { upsert: true }
    );
    await upsertOrphanetRedundancy(db, payload);
    result = payload;
  } else {
    result = await Terminology.findOneAndUpdate(
      { sistema: payload.sistema, codigo: payload.codigo },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return { skipped: false, record: result };
}

function extractRecords(responseData) {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.items)) return responseData.items;
  if (Array.isArray(responseData?.results)) return responseData.results;
  return [];
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const responseText = await response.text();

    let data;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (_error) {
        logger.warn(`Resposta não é JSON válido (content-type: "${contentType || 'desconhecido'}") de ${url}`);
        data = responseText;
      }
    } else {
      data = null;
    }

    if (!response.ok) {
      const statusMessage = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      const error = new Error(
        typeof data === 'object' && data && (data.error || data.message)
          ? String(data.error || data.message)
          : statusMessage
      );
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timeout após ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function syncFromOrphadata(db = null) {
  if (!isExternalTerminologySyncEnabled()) {
    logger.info('Sincronização externa Orphadata desabilitada neste ambiente');
    return {
      success: true,
      disabled: true,
      attempted: [],
      upserted: 0,
      skipped: 0,
      source: 'local-only',
    };
  }

  if (!ORPHADATA_BASE_URL) {
    return { success: true, disabled: true, attempted: [], upserted: 0, skipped: 0, source: 'local-only' };
  }

  // Endpoints públicos válidos conforme OpenAPI da Orphadata.
  const endpoints = [
    '/rd-cross-referencing/orphacodes?limit=1000',
    '/rd-phenotypes/orphacodes?limit=1000',
    '/rd-classification/orphacodes?limit=1000',
  ];

  const consulted = [];

  for (const endpoint of endpoints) {
    try {
      const url = `${ORPHADATA_BASE_URL.replace(/\/$/, '')}${endpoint}`;
      const responseData = await fetchJsonWithTimeout(url, DEFAULT_TIMEOUT_MS);
      const records = extractRecords(responseData?.data?.results ?? responseData);
      if (!records.length) {
        consulted.push({ endpoint, recordCount: 0 });
        continue;
      }
      consulted.push({ endpoint, recordCount: records.length });

      const stats = { attempted: endpoint, upserted: 0, skipped: 0 };
      for (const record of records) {
        const normalizedInput = (typeof record === 'string' || typeof record === 'number')
          ? {
            ORPHAcode: String(record),
            system: 'ORPHA',
            'Preferred term': `ORPHA ${String(record)}`,
          }
          : record;

        const normalized = normalizeRecord(
          normalizedInput,
          normalizedInput.sistema || normalizedInput.system || (normalizedInput.ORPHAcode || normalizedInput.orphaCode ? 'ORPHA' : 'OUTRO')
        );
        if (!normalized.codigo || !normalized.sistema || !normalized.descricao) {
          stats.skipped += 1;
          continue;
        }
        await upsertTerminology(normalized, db);
        stats.upserted += 1;
      }

      return { success: true, ...stats, consulted };
    } catch (error) {
      consulted.push({ endpoint, recordCount: 0, error: error.message });
      logger.warn(`Falha ao sincronizar terminologias via ${endpoint}: ${error.message}`);
    }
  }

  return { success: false, attempted: endpoints, upserted: 0, skipped: 0, consulted };
}

async function seedTerminologies(records = []) {
  let upserted = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      const result = await upsertTerminology(record, null);
      if (result.skipped) {
        skipped += 1;
      } else {
        upserted += 1;
      }
    } catch (error) {
      skipped += 1;
      logger.warn(`Falha ao semear terminologia ${record?.codigo || record?.code || 'desconhecido'}: ${error.message}`);
    }
  }

  return { success: true, upserted, skipped };
}

module.exports = {
  syncFromOrphadata,
  seedTerminologies,
  upsertTerminology,
  normalizeRecord,
  isExternalTerminologySyncEnabled,
  ensureTerminologyIndexes,
};
