const express = require('express');
const logger = require('../utils/logger');
const { isExternalTerminologySyncEnabled } = require('../services/terminologySync.service');

const { authenticate } = require('../infrastructure/middleware/auth');

const router = express.Router();
const COLLECTION = 'orphanet_diseases';
const ORPHADATA_BASE_URL = String(process.env.ORPHADATA_BASE_URL || '').replace(/\/$/, '');

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripKnownCodePrefix(value) {
  return normalizeText(value).replace(/^(ORPHA|OMIM):/i, '');
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

function normalizeReferenceList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

function normalizeExternalReferences(item = {}) {
  const refs = normalizeReferenceList(item.ExternalReference || item.externalReferences || item.externalReference);
  const pickReference = (source) => {
    const found = refs.find((ref) => String(ref?.Source || ref?.source || '').toUpperCase() === source);
    return normalizeText(found?.Reference || found?.reference || found?.code || found?.id || found?.value);
  };

  return {
    cid: normalizeText(item.Codigos_CID10 || item.cid10 || item.cid || item.icdCode || item.ICD10 || item.ICD_10 || pickReference('ICD-10')),
    omim: normalizeOmimCode(item.OMIM || item.omim || item.omimCode || pickReference('OMIM')),
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
    if (!record) continue;
    const normalized = normalizeDiseaseRecord(record, record.source);
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
      synonyms: Array.from(new Set([...previous.synonyms, ...normalized.synonyms])),
      aliases: Array.from(new Set([...previous.aliases, ...normalized.aliases])),
    });
  }

  return Array.from(map.values()).slice(0, limit);
}

async function searchLocal(db, search, lang, limit) {
  const regex = new RegExp(escapeRegex(search), 'i');
  const strippedSearch = stripKnownCodePrefix(search);
  const codeRegex = strippedSearch && strippedSearch !== normalizeText(search)
    ? new RegExp(escapeRegex(strippedSearch), 'i')
    : null;
  const numericOrpha = getOrphaNumeric(search);
  const records = [];

  const cidDocs = await db.collection('cids').find({
    $or: [
      { ORPHA: regex },
      { OMIM: regex },
      { Codigos_CID10: regex },
      { Codigo_Tabulacao: regex },
      { cid: regex },
      { cid10: regex },
      { icdCode: regex },
      { Descricao: regex },
      { description: regex },
      { label: regex },
      { namePt: regex },
      { nameEn: regex },
      { nameEs: regex },
      { aliases: regex },
      { synonyms: regex },
      { alternativeNames: regex },
      { 'relacoes.cid': regex },
      { 'relacoes.cid10': regex },
      { 'relacoes.omim': regex },
      ...(codeRegex ? [{ ORPHA: codeRegex }, { OMIM: codeRegex }, { 'relacoes.omim': codeRegex }, { 'relacoes.orpha': codeRegex }] : []),
      { ORPHA: new RegExp(`(^|[;,|])\\s*${escapeRegex(numericOrpha)}\\s*($|[;,|])`, 'i') },
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
      { ORPHAcode: regex },
      { name: regex },
      { label: regex },
      { description: regex },
      { synonyms: regex },
      { aliases: regex },
      { Codigos_CID10: regex },
      { OMIM: regex },
      { 'relacoes.cid': regex },
      { 'relacoes.cid10': regex },
      { 'relacoes.omim': regex },
      { 'relacoes.orpha': regex },
      ...(codeRegex ? [{ code: codeRegex }, { ORPHA: codeRegex }, { ORPHAcode: codeRegex }, { OMIM: codeRegex }, { 'relacoes.omim': codeRegex }, { 'relacoes.orpha': codeRegex }] : []),
      { code: numericOrpha }, { orphaCode: normalizeOrphaCode(numericOrpha) },
    ],
  };
  const requestedLang = normalizeText(lang).toLowerCase();
  let orphanetDocs = await db.collection(COLLECTION)
    .find({ ...orphanetFilter, $or: orphanetFilter.$or, lang: { $in: [requestedLang, '', null] } })
    .limit(limit)
    .toArray();

  if (orphanetDocs.length === 0) {
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

router.get('/search', authenticate, async (req, res) => {
  const q = normalizeText(req.query.q);
  const lang = normalizeText(req.query.lang) || 'pt';
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  if (!q) return res.status(400).json({ error: 'Missing query' });

  const db = req.app.locals.db;
  if (!db || typeof db.collection !== 'function') {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const localResults = await searchLocal(db, q, lang, limit);
    if (localResults.length > 0) {
      logger.info(`[ORPHANET] Busca concluida: queryLength=${q.length}, resultados=${localResults.length}, origem=local`);
      return res.json(localResults);
    }

    // searchRemote catches and logs its own per-URL errors internally and never rethrows,
    // so only searchLocal (above) can trigger this catch block — see #279.
    const remoteResults = await searchRemote(q, limit);
    if (remoteResults.length > 0) {
      const results = dedupeRecords(remoteResults, limit);
      logger.info(`[ORPHANET] Busca concluida: queryLength=${q.length}, resultados=${results.length}, origem=remote`);
      return res.json(results);
    }

    logger.info(`[ORPHANET] Busca concluida: queryLength=${q.length}, resultados=0, origem=vazio`);
    return res.json([]);
  } catch (error) {
    logger.warn(`[ORPHANET] Busca local falhou; tentando fallback local: ${error.message}`);
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
