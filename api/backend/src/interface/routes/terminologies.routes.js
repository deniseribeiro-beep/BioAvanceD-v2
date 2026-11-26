const express = require('express');
const Terminology = require('../../models/Terminology');
const {
  isExternalTerminologySyncEnabled,
  ensureTerminologyIndexes,
  ensureTerminologyLookupIndexes,
} = require('../../services/terminologySync.service');
const logger = require('../../utils/logger');
const { authenticate } = require('../../infrastructure/middleware/auth');

const router = express.Router();
const ORPHADATA_BASE_URL = (process.env.ORPHADATA_BASE_URL || '').replace(/\/$/, '');

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripKnownCodePrefix(value) {
  return normalizeText(value).replace(/^(ORPHA|OMIM):/i, '');
}

function splitCodes(value) {
  return normalizeText(value)
    .split(/[;,|]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildDelimitedCodeRegex(value) {
  const normalized = normalizeText(value).replace(/^ORPHA:/i, '');
  return normalized ? new RegExp(`(^|[;,|])\\s*${escapeRegex(normalized)}\\s*($|[;,|])`, 'i') : null;
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

function getOrphaNumeric(value) {
  return normalizeOrphaCode(value).replace(/^ORPHA:/i, '');
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

function buildTerminologyFromCid(doc = {}) {
  const cidCode = normalizeText(
    doc.Codigos_CID10
    || doc.cid10
    || doc.cid
    || doc.icdCode
    || doc.Codigo_Tabulacao
    || doc.relacoes?.cid10
    || doc.relacoes?.cid
  );
  const description = normalizeText(
    doc.Descricao
    || doc.descricao
    || doc.description
    || doc.label
    || doc.namePt
    || doc.nameEn
    || doc.nameEs
  );
  const aliases = [
    ...(Array.isArray(doc.aliases) ? doc.aliases : []),
    ...(Array.isArray(doc.synonyms) ? doc.synonyms : []),
    ...(Array.isArray(doc.alternativeNames) ? doc.alternativeNames : []),
  ].map((item) => normalizeText(item)).filter(Boolean);

  const orphaCodes = splitCodes(doc.ORPHA || doc.orpha || doc.orphaCode || doc.ORPHAcode || doc.relacoes?.orpha)
    .map(normalizeOrphaCode)
    .filter(Boolean);
  const omimCodes = splitCodes(doc.OMIM).map(normalizeOmimCode).filter(Boolean);

  return orphaCodes.map((orphaCode) => ({
    sistema: 'ORPHA',
    codigo: orphaCode,
    descricao: description || orphaCode,
    label: description || orphaCode,
    sinonimos: aliases,
    aliases,
    relacoes: {
      cid: cidCode,
      omim: omimCodes[0] || '',
      orpha: orphaCode,
      hpo: '',
    },
    ativo: doc.active !== false,
    sincronizadoEm: new Date(),
    updatedAt: new Date(),
    lang: 'pt',
    fonte: 'local-cids-redundancy',
  }));
}

function buildTerminologyFromOrphanetDisease(doc = {}) {
  const rawCode = normalizeText(doc.code || doc.orphaCode || doc.ORPHA || doc.ORPHAcode || doc.relacoes?.orpha);
  const codigo = normalizeOrphaCode(rawCode);
  if (!codigo) {
    return null;
  }

  const description = normalizeText(doc.name || doc.label || doc.descricao || doc.description);
  const synonyms = [
    ...(Array.isArray(doc.synonyms) ? doc.synonyms : []),
    ...(Array.isArray(doc.aliases) ? doc.aliases : []),
  ].map((item) => normalizeText(item)).filter(Boolean);
  const cid = normalizeText(doc.Codigos_CID10 || doc.cid10 || doc.cid || doc.icdCode || doc.relacoes?.cid10 || doc.relacoes?.cid);
  const omim = normalizeOmimCode(doc.OMIM || doc.omim || doc.omimCode || doc.relacoes?.omim);

  return {
    sistema: 'ORPHA',
    codigo,
    descricao: description || codigo,
    label: description || codigo,
    sinonimos: synonyms,
    aliases: synonyms,
    relacoes: {
      cid,
      cid10: cid,
      omim,
      orpha: codigo,
      hpo: '',
    },
    ativo: true,
    sincronizadoEm: new Date(),
    updatedAt: new Date(),
    lang: 'pt',
    fonte: 'local-orphanet-redundancy',
  };
}

async function bulkUpsertTerminologies(collection, records = []) {
  const validRecords = (Array.isArray(records) ? records : []).filter((item) => item && item.codigo && item.sistema && item.descricao);
  if (validRecords.length === 0) {
    return { upserted: 0 };
  }

  // #941: this is the second of the two racing writers the unique index was
  // added for, and the one the original fix did not wire. The service's
  // `upsertTerminology` db path has had no caller in `src/` since #115
  // retired the Orphadata bulk sync, so this path is the only live writer
  // here, and it was the only one not building the index. Latched per collection name, so this costs one
  // createIndex per process, not one per bulk write.
  await ensureTerminologyIndexes(collection, 'terminologies');

  const operations = validRecords.map((item) => ({
    updateOne: {
      filter: { sistema: item.sistema, codigo: item.codigo },
      update: { $set: { ...item, updatedAt: item.updatedAt || new Date() } },
      upsert: true,
    },
  }));

  await collection.bulkWrite(operations, { ordered: false });
  return { upserted: operations.length };
}

async function bulkUpsertOrphanetRedundancy(db, records = []) {
  const normalized = (Array.isArray(records) ? records : [])
    .filter((item) => String(item?.sistema || '').toUpperCase() === 'ORPHA')
    .map((item) => {
      const code = getOrphaNumeric(item.codigo || item.relacoes?.orpha || '');
      const cid = normalizeText(item.relacoes?.cid10 || item.relacoes?.cid || item.Codigos_CID10);
      const omim = normalizeOmimCode(item.relacoes?.omim || item.OMIM);
      const description = normalizeText(item.descricao || item.label || item.codigo);
      const aliases = Array.from(new Set([
        ...(Array.isArray(item.aliases) ? item.aliases : []),
        ...(Array.isArray(item.sinonimos) ? item.sinonimos : []),
      ].map((alias) => normalizeText(alias)).filter(Boolean)));
      return code ? {
        code,
        orphaCode: normalizeOrphaCode(code),
        ORPHA: code,
        ORPHAcode: code,
        name: description,
        label: description,
        description,
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
        source: normalizeText(item.fonte || 'terminologies-route'),
        updatedAt: new Date(),
      } : null;
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    return { upserted: 0 };
  }

  const operations = normalized.map((item) => ({
    updateOne: {
      filter: { code: item.code },
      update: { $set: item },
      upsert: true,
    },
  }));

  await db.collection('orphanet_diseases').bulkWrite(operations, { ordered: false });
  return { upserted: operations.length };
}

async function hydrateFromLocalRedundancy(db, { search, sistema, limit }) {
  const regex = new RegExp(escapeRegex(search), 'i');
  const strippedSearch = stripKnownCodePrefix(search);
  const codeRegex = strippedSearch && strippedSearch !== search
    ? new RegExp(escapeRegex(strippedSearch), 'i')
    : null;
  const numericOrpha = getOrphaNumeric(search);
  const delimitedOrphaRegex = buildDelimitedCodeRegex(search);
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const records = [];

  if (!sistema || sistema === 'ORPHA') {
    const cids = await db.collection('cids').find({
      $or: [
        { ORPHA: regex },
        { OMIM: regex },
        { Codigos_CID10: regex },
        { Codigo_Tabulacao: regex },
        { cid: regex },
        { cid10: regex },
        { icdCode: regex },
        { Descricao: regex },
        { descricao: regex },
        { description: regex },
        { label: regex },
        { namePt: regex },
        { nameEn: regex },
        { nameEs: regex },
        { aliases: regex },
        { synonyms: regex },
        { alternativeNames: regex },
        ...(numericOrpha && delimitedOrphaRegex ? [{ ORPHA: delimitedOrphaRegex }] : []),
        ...(codeRegex ? [{ ORPHA: codeRegex }, { OMIM: codeRegex }] : []),
      ],
    }).limit(max).toArray();

    cids.forEach((doc) => {
      records.push(...buildTerminologyFromCid(doc));
    });

    if (records.length < max) {
      const orphanetDocs = await db.collection('orphanet_diseases').find({
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
          ...(numericOrpha ? [{ code: numericOrpha }, { orphaCode: normalizeOrphaCode(numericOrpha) }] : []),
        ],
      }).limit(max).toArray();

      orphanetDocs.forEach((doc) => {
        const normalized = buildTerminologyFromOrphanetDisease(doc);
        if (normalized) {
          records.push(normalized);
        }
      });
    }
  }

  const dedupe = new Map();
  records.forEach((item) => {
    const key = `${item.sistema}::${item.codigo}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, item);
    }
  });

  return Array.from(dedupe.values()).slice(0, max);
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
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
      throw new Error(`Timeout ao consultar Orphadata (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeOrphaApiResult(item = {}) {
  const orpha = normalizeOrphaCode(item.ORPHAcode || item.orphaCode || item.orpha || item.codigo || item.code);
  if (!orpha) {
    return null;
  }

  const preferredTerm = normalizeText(item['Preferred term'] || item.preferredTerm || item.label || item.descricao || item.name);
  const externalRefs = normalizeExternalReferences(item);
  const synonymValues = Array.isArray(item.Synonym)
    ? item.Synonym.map((entry) => normalizeText(entry?.label || entry?.Label || entry?._ || entry)).filter(Boolean)
    : [];

  return {
    sistema: 'ORPHA',
    codigo: orpha,
    descricao: preferredTerm || orpha,
    label: preferredTerm || orpha,
    sinonimos: synonymValues,
    aliases: synonymValues,
    relacoes: {
      cid: externalRefs.cid,
      cid10: externalRefs.cid,
      hpo: '',
      omim: externalRefs.omim,
      orpha,
    },
    ativo: true,
    sincronizadoEm: new Date(),
    lang: 'en',
    fonte: 'orphadata-live',
    updatedAt: new Date(),
  };
}

function extractOrphadataResults(payload) {
  const data = payload?.data?.results ?? payload?.results ?? payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

async function hydrateFromOrphadata(search, limit) {
  if (!isExternalTerminologySyncEnabled()) {
    return [];
  }
  if (!ORPHADATA_BASE_URL) {
    return [];
  }

  const term = normalizeText(search);
  if (!term) {
    return [];
  }

  const numericOrpha = normalizeText(term).replace(/^ORPHA:/i, '');
  const requests = [
    `${ORPHADATA_BASE_URL}/rd-cross-referencing/orphacodes/names/${encodeURIComponent(term)}`,
  ];

  if (/^\d+$/.test(numericOrpha)) {
    requests.unshift(`${ORPHADATA_BASE_URL}/rd-cross-referencing/orphacodes/${encodeURIComponent(numericOrpha)}`);
  }

  const collected = [];
  for (const url of requests) {
    try {
      const payload = await fetchJsonWithTimeout(url);
      collected.push(...extractOrphadataResults(payload));
    } catch (error) {
      logger.warn(`Falha no fallback Orphadata (${url}): ${error.message}`);
    }
  }

  const normalized = collected
    .map((item) => normalizeOrphaApiResult(item))
    .filter(Boolean);

  const dedupe = new Map();
  normalized.forEach((item) => {
    const key = `${item.sistema}::${item.codigo}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, item);
    }
  });

  return Array.from(dedupe.values()).slice(0, limit);
}

function formatTerminology(terminology) {
  return {
    id: String(terminology._id),
    codigo: terminology.codigo,
    sistema: terminology.sistema,
    descricao: terminology.descricao,
    label: terminology.label || terminology.descricao,
    lang: terminology.lang || '',
    sinonimos: Array.isArray(terminology.sinonimos) ? terminology.sinonimos : [],
    aliases: Array.isArray(terminology.aliases) ? terminology.aliases : [],
    relacoes: terminology.relacoes || {},
    ativo: Boolean(terminology.ativo),
    sincronizadoEm: terminology.sincronizadoEm,
  };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const sistema = String(req.query.sistema || '').trim().toUpperCase();
    const search = String(req.query.q || req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const filter = {};
    if (sistema) {
      filter.sistema = sistema;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      const strippedSearch = stripKnownCodePrefix(search);
      const codeRegex = strippedSearch && strippedSearch !== search
        ? new RegExp(escapeRegex(strippedSearch), 'i')
        : null;
      filter.$or = [
        { codigo: searchRegex },
        { descricao: searchRegex },
        { label: searchRegex },
        { sinonimos: searchRegex },
        { aliases: searchRegex },
        { 'relacoes.cid': searchRegex },
        { 'relacoes.cid10': searchRegex },
        { 'relacoes.orpha': searchRegex },
        { 'relacoes.omim': searchRegex },
        ...(codeRegex ? [
          { codigo: codeRegex },
          { 'relacoes.orpha': codeRegex },
          { 'relacoes.omim': codeRegex },
        ] : []),
      ];
    }

    const terminologiesCollection = db.collection('terminologies');
    // #1163: un-awaited and best-effort, like the facility/room list routes.
    ensureTerminologyLookupIndexes(terminologiesCollection);
    let [items, total] = await Promise.all([
      terminologiesCollection.find(filter).sort({ sistema: 1, codigo: 1 }).limit(limit).toArray(),
      terminologiesCollection.countDocuments(filter),
    ]);

    if (items.length === 0 && search) {
      const redundantRecords = await hydrateFromLocalRedundancy(db, { search, sistema, limit });
      if (redundantRecords.length > 0) {
        await bulkUpsertTerminologies(terminologiesCollection, redundantRecords);
        [items, total] = await Promise.all([
          terminologiesCollection.find(filter).sort({ sistema: 1, codigo: 1 }).limit(limit).toArray(),
          terminologiesCollection.countDocuments(filter),
        ]);
      }
    }

    if (items.length === 0 && search && (!sistema || sistema === 'ORPHA')) {
      const remoteRecords = await hydrateFromOrphadata(search, limit);
      if (remoteRecords.length > 0) {
        await bulkUpsertTerminologies(terminologiesCollection, remoteRecords);
        await bulkUpsertOrphanetRedundancy(db, remoteRecords);
        [items, total] = await Promise.all([
          terminologiesCollection.find(filter).sort({ sistema: 1, codigo: 1 }).limit(limit).toArray(),
          terminologiesCollection.countDocuments(filter),
        ]);
      }
    }

    res.json({
      success: true,
      data: items.map(formatTerminology),
      pagination: {
        total,
        limit,
      },
    });
  } catch (error) {
    logger.error(`Erro ao listar terminologias: ${error.message}`);
    res.status(500).json({ success: false, error: 'Erro ao listar terminologias' });
  }
});

module.exports = router;
