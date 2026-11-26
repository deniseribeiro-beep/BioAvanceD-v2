// backend/src/routes/dictionary.js
const express = require('express');
const router = express.Router();
const redis = require('redis');
const { getNeo4jDriver } = require('../database/neo4j');
const DrugService = require('../services/DrugService');
const { escapeRegex } = require('../utils/escapeRegex');
const { checkActiveCode } = require('../ingestion/activeCodeValidator');
const { findAssociationsForOrpha } = require('../services/biomarkerAssociation.service');
const { currentRequestId, neo4jTxConfig } = require('../utils/requestContext');

let redisClient = null;
let redisConnectPromise = null;
let redisAvailable = true;

async function getRedisClient() {
  if (!redisAvailable) return null;
  if (!redisClient) {
    redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', () => {
      redisAvailable = false;
    });
  }

  if (!redisClient.isOpen) {
    redisConnectPromise = redisConnectPromise || redisClient.connect().catch(() => {
      redisAvailable = false;
      return null;
    });
    await redisConnectPromise;
    redisConnectPromise = null;
  }

  return redisClient.isOpen ? redisClient : null;
}

async function getCacheValue(cacheKey) {
  const client = await getRedisClient();
  return client ? client.get(cacheKey) : null;
}

async function setCacheValue(cacheKey, ttlSeconds, value) {
  const client = await getRedisClient();
  if (client) {
    await client.setEx(cacheKey, ttlSeconds, value);
  }
}

function normalizeCoding(raw = {}, fallbackSystem) {
  const system = String(raw.system || fallbackSystem || '').trim();
  const code = String(raw.code || '').trim();
  const display = String(raw.display || '').trim();

  if (!system || !code || !display) {
    return null;
  }

  return { system, code, display };
}

function normalizeOrphaCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/^ORPHA:/i, '');
}

function normalizeDiseaseProfile(record = {}) {
  // The biomarker requirements are not served (#1206): BiomarkerAssociation
  // holds that knowledge, and every other key passes through.
  const requirements = record?.validation_requirements && typeof record.validation_requirements === 'object'
    ? { ...record.validation_requirements }
    : {};
  delete requirements.biomarkers;

  return {
    orpha_code: normalizeOrphaCode(record.orpha_code),
    name: String(record.name || '').trim(),
    disease_category: String(record.disease_category || '').trim(),
    validation_requirements: requirements,
    drug_classes: Array.isArray(record.drug_classes) ? record.drug_classes : [],
  };
}

function normalizeHpoCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^HP:/i.test(raw) ? raw.replace(/^hp:/i, 'HP:') : raw;
}

function normalizeLocalPhenotype(raw = {}) {
  const code = normalizeHpoCode(raw.hpoId || raw.code || raw.codigo || raw.relacoes?.hpo);
  const display = String(raw.label || raw.display || raw.descricao || raw.name || raw.nome || code).trim();
  return normalizeCoding({ system: 'http://purl.obolibrary.org/obo/hp.owl', code, display }, 'http://purl.obolibrary.org/obo/hp.owl');
}

function analyteCoding({ analyte }) {
  const display = typeof analyte.display === 'string' && analyte.display.trim() ? analyte.display : analyte.code;
  return normalizeCoding({ system: analyte.systemUri, code: analyte.code, display });
}

function uniqueCodings(codings = []) {
  const seen = new Set();
  return codings.filter((item) => {
    const key = `${item.system}::${item.code}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildLocalSemanticSuggestions(db, orphaCode) {
  const normalizedOrpha = normalizeOrphaCode(orphaCode);
  if (!normalizedOrpha) {
    return null;
  }

  const disease = await db.collection('disease_dictionary').findOne({
    orpha_code: normalizedOrpha,
    active: { $ne: false },
  });

  const terminologyRows = await db.collection('terminologies').find({
    $or: [
      { 'relacoes.orpha': normalizedOrpha },
      { 'relacoes.orpha': `ORPHA:${normalizedOrpha}` },
      { codigo: normalizedOrpha },
      { codigo: `ORPHA:${normalizedOrpha}` },
    ],
    ativo: { $ne: false },
  }).limit(100).toArray();

  const hpoRows = terminologyRows.filter((item) => {
    const system = String(item.sistema || item.system || '').trim().toUpperCase();
    return system === 'HPO' || Boolean(item.relacoes?.hpo);
  });

  const phenotypes = uniqueCodings([
    ...(Array.isArray(disease?.phenotypes) ? disease.phenotypes.map(normalizeLocalPhenotype) : []),
    ...hpoRows.map((item) => normalizeLocalPhenotype({
      ...item,
      code: item.relacoes?.hpo || item.codigo,
      label: item.label || item.descricao,
    })),
  ].filter(Boolean));

  // #1206: the biomarkers are the analytes of the valid BiomarkerAssociation
  // rows for this disease, no longer disease_dictionary's lists.
  const associations = await findAssociationsForOrpha(db, normalizedOrpha);
  const biomarkers = uniqueCodings(associations.map(analyteCoding).filter(Boolean));

  if (!disease && phenotypes.length === 0 && biomarkers.length === 0) {
    return null;
  }

  return {
    disease: normalizeCoding({
      system: 'http://www.orpha.net',
      code: normalizedOrpha,
      display: disease?.name || `ORPHA ${normalizedOrpha}`,
    }, 'http://www.orpha.net'),
    phenotypes,
    biomarkers,
  };
}

/**
 * RF029 AC4 on the read side (#885): the write side (intakeWizard's
 * recordClinicalEntities -> phenotype-observation.service) checks every
 * phenotype's hpoCoding against an active ReferenceDatasetRelease and skips
 * the observation when it fails, so a suggestion outside an active release
 * is one the operator can pick and the server will not record. Each
 * phenotype runs the same checkActiveCode the write side runs, on the same
 * systemUri+code pair, and only active ones are offered. Every coding whose
 * concept resolves active also carries that concept's `version`, the one the
 * write side would stamp (#866).
 *
 * Only phenotypes are filtered, because only they are gated on write. The
 * disease is the code the operator asked about, and the biomarkers are the
 * analyte Codings of BiomarkerAssociation rows (#1206), which no write gates,
 * so both are annotated, never dropped. Excluded phenotypes are listed in `releaseGate.excluded` with the
 * validator's status, so an empty list is distinguishable from "no
 * phenotypes known".
 *
 * Runs per response, after the cache, so a release promoted or retired takes
 * effect on the next request rather than after the cache TTL. Without a db
 * the gate cannot run and the payload goes out as before, with no
 * `releaseGate` field; app.js always sets app.locals.db.
 */
async function applyReleaseGate(db, payload) {
  if (!db || typeof db.collection !== 'function' || !payload) return payload;

  const check = async (coding) => {
    if (!coding?.system || !coding?.code) return { coding, result: null };
    const result = await checkActiveCode(db, { systemUri: coding.system, code: coding.code });
    const version = result.active ? result.concept?.version : null;
    return { coding: version ? { ...coding, version } : coding, result };
  };

  const phenotypeChecks = await Promise.all((payload.phenotypes || []).map(check));
  const biomarkerChecks = await Promise.all((payload.biomarkers || []).map(check));
  const diseaseCheck = payload.disease ? await check(payload.disease) : null;

  return {
    ...payload,
    disease: diseaseCheck ? diseaseCheck.coding : payload.disease,
    phenotypes: phenotypeChecks.filter(({ result }) => result?.active).map(({ coding }) => coding),
    biomarkers: biomarkerChecks.map(({ coding }) => coding),
    releaseGate: {
      status: 'applied',
      excluded: phenotypeChecks
        .filter(({ result }) => !result?.active)
        .map(({ coding, result }) => ({ ...coding, status: result?.status || 'unknown' })),
    },
  };
}

async function sendSuggestions(req, res, payload) {
  try {
    return res.json(await applyReleaseGate(req.app.locals.db, payload));
  } catch (gateError) {
    return res.status(500).json({ error: gateError.message });
  }
}

function normalizeMedicationRecord(raw = {}) {
  const atcCode = String(raw.atc_code || raw.code || '').replace(/^ATC:/i, '').trim().toUpperCase();
  return {
    code: String(raw.code || '').trim() || (atcCode ? `ATC:${atcCode}` : ''),
    name: String(raw.name || raw.generic_name || raw.display || '').trim(),
    generic_name: String(raw.generic_name || raw.name || raw.display || '').trim(),
    atc_code: atcCode,
    atc_level_1: String(raw.atc_level_1 || '').trim().toUpperCase() || (atcCode ? atcCode.charAt(0) : ''),
    atc_classifications: Array.isArray(raw.atc_classifications)
      ? raw.atc_classifications.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)
      : (atcCode ? [atcCode] : []),
    synonyms: Array.isArray(raw.synonyms)
      ? raw.synonyms.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    drug_class: String(raw.drug_class || '').trim(),
    disease_categories: Array.isArray(raw.disease_categories)
      ? raw.disease_categories.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    active: raw.active !== false,
  };
}

const medicationDictionaryIndexedDbs = new WeakSet();

async function ensureMedicationDictionaryIndexes(db) {
  if (medicationDictionaryIndexedDbs.has(db)) return;
  const collection = db.collection('medication_dictionary');
  await collection.createIndex({ generic_name: 1 }, { name: 'generic_name_idx' });
  await collection.createIndex({ atc_code: 1 }, { name: 'atc_code_idx' });
  await collection.createIndex({ name: 'text', generic_name: 'text', synonyms: 'text', code: 'text', atc_code: 'text' }, { name: 'medication_text_idx' });
  await collection.createIndex({ drug_class: 1 }, { name: 'drug_class_idx' });
  await collection.createIndex({ disease_categories: 1 }, { name: 'disease_categories_idx' });
  medicationDictionaryIndexedDbs.add(db);
}

router.get('/atc/search', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  const query = String(req.query?.query || req.query?.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  try {
    await ensureMedicationDictionaryIndexes(db);
    const drugService = new DrugService(db);
    const medications = await drugService.searchAndCacheDrug(query, {
      limit: Math.min(Math.max(Number(req.query?.limit || 10), 1), 50),
      auditContext: {
        req,
        userID: req.user?.userID || req.user?.id || req.user?._id || null,
      },
    });

    return res.json({ medications: medications.map((item) => normalizeMedicationRecord(item)) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Busca ORPHA/HPO com cache
router.get('/search', async (req, res) => {
  const { query = '' } = req.query;
  if (typeof query !== 'string') return res.status(400).json({ error: 'Invalid query' });
  if (!query.trim()) return res.status(400).json({ error: 'Missing query' });
  const cacheKey = `orpha:search:${String(query).toLowerCase()}`;
  try {
    // 1. Tenta cache
    const cached = await getCacheValue(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const driver = getNeo4jDriver();
    const session = driver.session();
    const result = await session.run(
      `
        MATCH (d:Doenca_ORPHA)
        WHERE toLower(coalesce(d.nome, '')) CONTAINS toLower($query)
           OR toLower(coalesce(d.code, '')) CONTAINS toLower($query)
        RETURN d
        ORDER BY d.nome
        LIMIT 20
      `,
      { query: String(query).trim() },
      neo4jTxConfig(currentRequestId())
    );
    await session.close();

    const payload = {
      results: result.records
        .map((record) => record.get('d')?.properties || null)
        .filter(Boolean)
        .map((disease) => normalizeCoding({
          system: 'http://www.orpha.net',
          code: disease.code,
          display: disease.nome || disease.name || disease.code,
        }, 'http://www.orpha.net'))
        .filter(Boolean),
    };

    await setCacheValue(cacheKey, 3600, JSON.stringify(payload));
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sugestão semântica via Neo4j
router.get('/suggest', async (req, res) => {
  const { orphaCode } = req.query;
  if (!orphaCode) return res.status(400).json({ error: 'Missing orphaCode' });
  // Accept "324" or "ORPHA:324"; Neo4j nodes may store either spelling.
  const numericOrpha = normalizeOrphaCode(orphaCode);
  if (!numericOrpha) return res.status(400).json({ error: 'Missing orphaCode' });
  const prefixedOrpha = `ORPHA:${numericOrpha}`;
  const cacheKey = `orpha:suggest:${numericOrpha}`;
  try {
    const cached = await getCacheValue(cacheKey);
    if (cached) return sendSuggestions(req, res, JSON.parse(cached));

    const driver = getNeo4jDriver();
    const session = driver.session();
    // Cypher: match numeric or prefixed code on Doenca_ORPHA.
    const cypher = `
      MATCH (d:Doenca_ORPHA)
      WHERE d.code = $numericOrpha
         OR d.code = $prefixedOrpha
         OR replace(toUpper(coalesce(d.code, '')), 'ORPHA:', '') = $numericOrpha
      OPTIONAL MATCH (d)-[:APRESENTA_FENOTIPO]->(h:Fenotipo_HPO)
      OPTIONAL MATCH (d)-[:POSSUI_BIOMARCADOR]->(b:Biomarcador)
      RETURN d, collect(DISTINCT h) as fenotipos, collect(DISTINCT b) as biomarcadores
      LIMIT 1
    `;
    const result = await session.run(
      cypher,
      { numericOrpha, prefixedOrpha },
      neo4jTxConfig(currentRequestId())
    );
    await session.close();
    if (!result.records.length) {
      const dbMiss = req.app.locals.db;
      if (dbMiss && typeof dbMiss.collection === 'function') {
        const fallbackMiss = await buildLocalSemanticSuggestions(dbMiss, numericOrpha);
        if (fallbackMiss) {
          await setCacheValue(cacheKey, 3600, JSON.stringify(fallbackMiss));
          return sendSuggestions(req, res, fallbackMiss);
        }
      }
      return res.status(404).json({ error: 'Not found' });
    }
    const d = result.records[0].get('d').properties;
    let phenotypes = result.records[0].get('fenotipos')
      .map((h) => (h && h.properties ? normalizeCoding({
        system: 'http://purl.obolibrary.org/obo/hp.owl',
        code: h.properties.code,
        display: h.properties.nome || h.properties.name,
      }, 'http://purl.obolibrary.org/obo/hp.owl') : null))
      .filter(Boolean);
    let biomarkers = result.records[0].get('biomarcadores')
      .map((b) => (b && b.properties ? normalizeCoding({
        system: 'http://loinc.org',
        code: b.properties.code || b.properties.nome,
        display: b.properties.nome || b.properties.name,
      }, 'http://loinc.org') : null))
      .filter(Boolean);

    // Until PHR-003 outbox projects POSSUI_BIOMARCADOR, Neo4j often returns
    // the disease with an empty biomarker list — merge Mongo associations.
    if (biomarkers.length === 0) {
      const dbMerge = req.app.locals.db;
      if (dbMerge && typeof dbMerge.collection === 'function') {
        const local = await buildLocalSemanticSuggestions(dbMerge, numericOrpha);
        if (local?.biomarkers?.length) {
          biomarkers = local.biomarkers;
        }
        if (phenotypes.length === 0 && local?.phenotypes?.length) {
          phenotypes = local.phenotypes;
        }
      }
    }

    const response = {
      disease: normalizeCoding({
        system: 'http://www.orpha.net',
        code: d.code,
        display: d.nome || d.name || d.code,
      }, 'http://www.orpha.net'),
      phenotypes,
      biomarkers,
    };

    await setCacheValue(cacheKey, 3600, JSON.stringify(response));
    return sendSuggestions(req, res, response);
  } catch (err) {
    const db = req.app.locals.db;
    if (!db || typeof db.collection !== 'function') {
      return res.status(500).json({ error: err.message });
    }

    try {
      const fallback = await buildLocalSemanticSuggestions(db, numericOrpha);
      if (fallback) {
        await setCacheValue(cacheKey, 3600, JSON.stringify(fallback));
        return sendSuggestions(req, res, fallback);
      }

      return res.status(404).json({ error: 'Not found' });
    } catch (fallbackError) {
      return res.status(500).json({ error: fallbackError.message || err.message });
    }
  }
});

router.get('/disease-profile', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  const orphaCode = normalizeOrphaCode(req.query?.orphaCode);
  if (!orphaCode) {
    return res.status(400).json({ error: 'Missing orphaCode' });
  }

  try {
    const collection = db.collection('disease_dictionary');
    const disease = await collection.findOne({ orpha_code: orphaCode, active: { $ne: false } });
    // No stack seeds disease_dictionary (a legacy store, seeded only by
    // hand, #1200), so this 404 is the expected answer. The intake wizard
    // treats it as "no disease profile".
    if (!disease) {
      return res.status(404).json({ error: 'Disease profile not found' });
    }

    return res.json({
      disease: normalizeDiseaseProfile(disease),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const SIGTAP_SYSTEM_URI = 'https://terminologia.saude.gov.br/fhir/CodeSystem/BRTabelaSUS';

router.get('/procedures/search', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  const query = String(req.query?.query || req.query?.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50);
  try {
    const regex = new RegExp(escapeRegex(query), 'i');
    const concepts = await db.collection('terminologyConcepts')
      .find({
        systemUri: SIGTAP_SYSTEM_URI,
        obsolete: { $ne: true },
        $or: [{ code: regex }, { display: regex }],
      })
      .sort({ display: 1 })
      .limit(limit)
      .toArray();

    const institutional = await db.collection('institutionalProcedureCodes')
      .find({
        active: { $ne: false },
        $or: [{ code: regex }, { display: regex }, { name: regex }],
      })
      .sort({ display: 1, name: 1 })
      .limit(limit)
      .toArray()
      .catch(() => []);

    const procedures = [
      ...concepts.map((row) => ({
        code: row.code,
        display: row.display,
        systemUri: row.systemUri || SIGTAP_SYSTEM_URI,
        source: 'SIGTAP',
      })),
      ...institutional.map((row) => ({
        code: row.code,
        display: row.display || row.name || row.code,
        systemUri: row.systemUri || 'institutional',
        source: 'INSTITUTIONAL',
      })),
    ].slice(0, limit);

    return res.json({ procedures });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/institutional-procedures', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });
  try {
    const rows = await db.collection('institutionalProcedureCodes')
      .find({ active: { $ne: false } })
      .sort({ display: 1, name: 1 })
      .limit(200)
      .toArray();
    return res.json({
      procedures: rows.map((row) => ({
        id: String(row._id),
        code: row.code,
        display: row.display || row.name || row.code,
        active: row.active !== false,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/institutional-procedures', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });
  const code = String(req.body?.code || '').trim();
  const display = String(req.body?.display || req.body?.name || '').trim();
  if (!code || !display) {
    return res.status(400).json({ error: 'code and display are required' });
  }
  try {
    const now = new Date();
    const result = await db.collection('institutionalProcedureCodes').updateOne(
      { code },
      {
        $set: {
          code,
          display,
          name: display,
          active: true,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    return res.status(result.upsertedCount ? 201 : 200).json({ code, display, active: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/medications/search', async (req, res) => {
  const db = req.app.locals.db;
  if (!db) return res.status(503).json({ error: 'Database unavailable' });

  const query = String(req.query?.query || req.query?.q || '').trim();
  const diseaseCategory = String(req.query?.diseaseCategory || '').trim();
  const drugClasses = String(req.query?.drugClasses || '')
    .split(',')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const limit = Math.min(Math.max(Number(req.query?.limit || 20), 1), 50);

  try {
    await ensureMedicationDictionaryIndexes(db);
    const collection = db.collection('medication_dictionary');

    const filters = [{ active: { $ne: false } }];
    if (query) {
      const regex = new RegExp(escapeRegex(query), 'i');
      filters.push({
        $or: [
          { name: regex },
          { generic_name: regex },
          { synonyms: regex },
          { code: regex },
          { atc_code: regex },
        ],
      });
    }

    if (diseaseCategory) {
      filters.push({ disease_categories: diseaseCategory });
    }

    if (drugClasses.length > 0) {
      filters.push({ drug_class: { $in: drugClasses } });
    }

    const mongoFilter = filters.length === 1 ? filters[0] : { $and: filters };
    const rows = await collection
      .find(mongoFilter)
      .sort({ name: 1 })
      .limit(limit)
      .toArray();

    const medications = rows.map((row) => normalizeMedicationRecord(row));
    return res.json({ medications });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
