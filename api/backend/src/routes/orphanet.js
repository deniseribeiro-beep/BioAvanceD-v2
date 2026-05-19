const express = require('express');
const logger = require('../utils/logger');
const { isExternalTerminologySyncEnabled } = require('../services/terminologySync.service');

const router = express.Router();
const COLLECTION = 'orphanet_diseases';
const ORPHADATA_BASE_URL = String(process.env.ORPHADATA_BASE_URL || '').replace(/\/$/, '');

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOrphaCode(value) {
  const raw = normalizeText(value).replace(/^ORPHA:/i, '');
  return raw ? `ORPHA:${raw}` : '';
}

function getOrphaNumeric(value) {
  return normalizeOrphaCode(value).replace(/^ORPHA:/i, '');
}

function normalizeOmimCode(value) {
  const raw = normalizeText(value).replace(/^OMIM:/i, '');
  return raw ? `OMIM:${raw}` : '';
}

function splitCodes(value) {
  return normalizeText(value)
    .split(/[;,|]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeExternalReferences(item = {}) {
  const refs = Array.isArray(item.ExternalReference) ? item.ExternalReference : [];
  return {
    cid: normalizeText(refs.find((ref) => String(ref?.Source || '').toUpperCase() === 'ICD-10')?.Reference),
    omim: normalizeOmimCode(refs.find((ref) => String(ref?.Source || '').toUpperCase() === 'OMIM')?.Reference),
  };
}

function normalizeDiseaseRecord(item = {}, source = 'local') {
  const externalRefs = normalizeExternalReferences(item);
  const orpha = normalizeOrphaCode(
    item.ORPHA
    || item.orpha
    || item.orphaCode
    || item.ORPHAcode
    || item.code
    || item.codigo
    || item.relacoes?.orpha
  );
  const orphaNumeric = getOrphaNumeric(orpha);
  if (!orphaNumeric) return null;

  const cid = normalizeText(
    item.Codigos_CID10
    || item.cid10
    || item.cid
    || item.icdCode
    || item.relacoes?.cid10
    || item.relacoes?.cid
    || externalRefs.cid
  );
  const omim = normalizeOmimCode(
    item.OMIM
    || item.omim
    || item.omimCode
    || item.relacoes?.omim
    || externalRefs.omim
  );
  const synonyms = [
    ...(Array.isArray(item.synonyms) ? item.synonyms : []),
    ...(Array.isArray(item.aliases) ? item.aliases : []),
    ...(Array.isArray(item.Synonym) ? item.Synonym.map((entry) => entry?.label || entry?.Label || entry?._ || entry) : []),
  ].map(normalizeText).filter(Boolean);
  const name = normalizeText(
    item.name
    || item.namePt
    || item.nameEn
    || item.nameEs
    || item.Descricao
    || item.descricao
    || item.description
    || item.label
    || item['Preferred term']
    || item.preferredTerm
    || orpha
  );

  return {
    id: normalizeText(item._id || item.id || `orpha-${orphaNumeric}`),
    code: orphaNumeric,
    name,
    label: name,
    description: name,
    orphaCode: orpha,
    ORPHA: orphaNumeric,
    ORPHAcode: orphaNumeric,
    Codigos_CID10: cid,
    OMIM: omim,
    synonyms,
    aliases: synonyms,
    lang: normalizeText(item.lang || item.language || 'pt').toLowerCase(),
    source,
    relacoes: {
      cid,
      cid10: cid,
      omim,
      orpha,
    },
  };
}

function dedupeRecords(records = [], limit = 20) {
  const map = new Map();
  for (const record of records) {
    const normalized = normalizeDiseaseRecord(record, record?.source || 'local');
    if (!normalized) continue;

    const key = getOrphaNumeric(normalized.orphaCode);
    const previous = map.get(key);
    if (!previous) {
      map.set(key, normalized);
      continue;
    }

    map.set(key, {
      ...previous,
      ...normalized,
      Codigos_CID10: previous.Codigos_CID10 || normalized.Codigos_CID10,
      OMIM: previous.OMIM || normalized.OMIM,
      relacoes: {
        ...normalized.relacoes,
        cid: previous.relacoes?.cid || normalized.relacoes?.cid,
        cid10: previous.relacoes?.cid10 || normalized.relacoes?.cid10,
        omim: previous.relacoes?.omim || normalized.relacoes?.omim,
      },
      synonyms: Array.from(new Set([...(previous.synonyms || []), ...(normalized.synonyms || [])])),
      aliases: Array.from(new Set([...(previous.aliases || []), ...(normalized.aliases || [])])),
    });
  }

  return Array.from(map.values()).slice(0, limit);
}

async function searchLocal(db, search, lang, limit) {
  const regex = new RegExp(escapeRegex(search), 'i');
  const numericOrpha = getOrphaNumeric(search);
  const records = [];

  const cidDocs = await db.collection('cids').find({
    $or: [
      { ORPHA: regex },
      { OMIM: regex },
      { Codigos_CID10: regex },
      { Codigo_Tabulacao: regex },
      { Descricao: regex },
      { namePt: regex },
      { nameEn: regex },
      { nameEs: regex },
      { aliases: regex },
      { synonyms: regex },
      ...(numericOrpha ? [{ ORPHA: new RegExp(`(^|[;,|])\\s*${escapeRegex(numericOrpha)}\\s*($|[;,|])`, 'i') }] : []),
    ],
  }).limit(limit).toArray();

  for (const doc of cidDocs) {
    const orphaCodes = splitCodes(doc.ORPHA);
    for (const orpha of orphaCodes) {
      records.push(normalizeDiseaseRecord({ ...doc, ORPHA: orpha }, 'local-cids'));
    }
  }

  const orphanetFilter = {
    $or: [
      { code: regex },
      { orphaCode: regex },
      { ORPHA: regex },
      { name: regex },
      { label: regex },
      { description: regex },
      { synonyms: regex },
      { aliases: regex },
      { 'relacoes.cid': regex },
      { 'relacoes.cid10': regex },
      { 'relacoes.omim': regex },
      ...(numericOrpha ? [{ code: numericOrpha }, { orphaCode: normalizeOrphaCode(numericOrpha) }] : []),
    ],
  };
  const requestedLang = normalizeText(lang).toLowerCase();
  let orphanetDocs = await db.collection(COLLECTION)
    .find(requestedLang ? { ...orphanetFilter, $or: orphanetFilter.$or, lang: { $in: [requestedLang, '', null] } } : orphanetFilter)
    .limit(limit)
    .toArray();

  if (requestedLang && orphanetDocs.length === 0) {
    orphanetDocs = await db.collection(COLLECTION)
      .find(orphanetFilter)
      .limit(limit)
      .toArray();
  }

  records.push(...orphanetDocs.map((doc) => normalizeDiseaseRecord(doc, doc.source || 'local-orphanet')));
  return dedupeRecords(records, limit);
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`timeout ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractOrphadataResults(payload) {
  const data = payload?.data?.results ?? payload?.results ?? payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

async function searchRemote(search, limit) {
  if (!isExternalTerminologySyncEnabled() || !ORPHADATA_BASE_URL) {
    return [];
  }

  const term = normalizeText(search);
  const numericOrpha = getOrphaNumeric(term);
  const urls = [
    `${ORPHADATA_BASE_URL}/rd-cross-referencing/orphacodes/names/${encodeURIComponent(term)}`,
  ];

  if (/^\d+$/.test(numericOrpha)) {
    urls.unshift(`${ORPHADATA_BASE_URL}/rd-cross-referencing/orphacodes/${encodeURIComponent(numericOrpha)}`);
  }

  const records = [];
  for (const url of urls) {
    try {
      const payload = await fetchJsonWithTimeout(url);
      records.push(...extractOrphadataResults(payload).map((item) => normalizeDiseaseRecord(item, 'orphadata-live')));
    } catch (error) {
      logger.warn(`[ORPHANET] Consulta externa indisponivel para busca de doencas: ${error.message}`);
    }
  }

  return dedupeRecords(records, limit);
}

async function upsertLocalCache(db, records = []) {
  const valid = dedupeRecords(records, records.length || 1);
  if (valid.length === 0) return { cached: 0 };

  await db.collection(COLLECTION).bulkWrite(valid.map((record) => ({
    updateOne: {
      filter: { code: getOrphaNumeric(record.orphaCode) },
      update: {
        $set: {
          code: getOrphaNumeric(record.orphaCode),
          orphaCode: record.orphaCode,
          ORPHA: record.ORPHA,
          ORPHAcode: record.ORPHAcode,
          name: record.name,
          label: record.label,
          description: record.description,
          Codigos_CID10: record.Codigos_CID10,
          OMIM: record.OMIM,
          synonyms: record.synonyms,
          aliases: record.aliases,
          relacoes: record.relacoes,
          lang: record.lang || 'pt',
          source: record.source || 'orphanet-search',
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      upsert: true,
    },
  })), { ordered: false });

  await db.collection('terminologies').bulkWrite(valid.map((record) => ({
    updateOne: {
      filter: { sistema: 'ORPHA', codigo: record.orphaCode },
      update: {
        $set: {
          sistema: 'ORPHA',
          codigo: record.orphaCode,
          descricao: record.description || record.name || record.orphaCode,
          label: record.label || record.description || record.orphaCode,
          sinonimos: record.synonyms || [],
          aliases: record.aliases || [],
          relacoes: record.relacoes || {},
          ativo: true,
          lang: record.lang || 'pt',
          fonte: record.source || 'orphanet-search-cache',
          sincronizadoEm: new Date(),
        },
      },
      upsert: true,
    },
  })), { ordered: false });

  return { cached: valid.length };
}

router.get('/search', async (req, res) => {
  const q = normalizeText(req.query.q);
  const lang = normalizeText(req.query.lang || 'pt');
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  if (!q) return res.status(400).json({ error: 'Missing query' });

  const db = req.app.locals.db;
  if (!db || typeof db.collection !== 'function') {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const remoteResults = await searchRemote(q, limit);
    if (remoteResults.length > 0) {
      const cacheResult = await upsertLocalCache(db, remoteResults);
      logger.info(`[ORPHANET] Busca externa cacheada: resultados=${remoteResults.length}, upserts=${cacheResult.cached}`);
    }

    const localResults = await searchLocal(db, q, lang, limit);
    const results = dedupeRecords([...remoteResults, ...localResults], limit);
    logger.info(`[ORPHANET] Busca concluida: queryLength=${q.length}, resultados=${results.length}, origem=${remoteResults.length > 0 ? 'remote+local' : 'local'}`);
    res.json(results);
  } catch (error) {
    logger.warn(`[ORPHANET] Busca externa/local falhou; tentando fallback local: ${error.message}`);
    try {
      const fallbackResults = await searchLocal(db, q, lang, limit);
      res.json(fallbackResults);
    } catch (fallbackError) {
      logger.error(`[ORPHANET] Fallback local falhou: ${fallbackError.message}`);
      res.status(500).json({ error: 'Failed to search orphanet diseases' });
    }
  }
});

module.exports = router;
