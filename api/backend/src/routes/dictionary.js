// backend/src/routes/dictionary.js
const express = require('express');
const router = express.Router();
const redis = require('redis');
const { getNeo4jDriver } = require('../database/neo4j');
const DrugService = require('../services/DrugService');

const DEFAULT_MEDICATIONS = [
  {
    code: 'ATC:A16AB04',
    atc_code: 'A16AB04',
    atc_level_1: 'A',
    name: 'Agalsidase beta',
    synonyms: ['Fabrazyme', 'Agalsidase-Beta'],
    drug_class: 'enzyme_replacement_therapy',
    disease_categories: ['Erros Inatos do Metabolismo'],
  },
  {
    code: 'ATC:A16AB03',
    atc_code: 'A16AB03',
    atc_level_1: 'A',
    name: 'Agalsidase alfa',
    synonyms: ['Replagal', 'Agalsidase-Alfa'],
    drug_class: 'enzyme_replacement_therapy',
    disease_categories: ['Erros Inatos do Metabolismo'],
  },
  {
    code: 'ATC:A16AX14',
    atc_code: 'A16AX14',
    atc_level_1: 'A',
    name: 'Migalastat',
    synonyms: ['Galafold'],
    drug_class: 'pharmacological_chaperone',
    disease_categories: ['Erros Inatos do Metabolismo'],
  },
  {
    code: 'ATC:H02AB02',
    atc_code: 'H02AB02',
    atc_level_1: 'H',
    name: 'Deflazacorte',
    synonyms: ['Deflazacort'],
    drug_class: 'corticosteroid',
    disease_categories: ['Doencas Neurologicas'],
  },
  {
    code: 'ATC:M09AX03',
    atc_code: 'M09AX03',
    atc_level_1: 'M',
    name: 'Atalureno',
    synonyms: ['Translarna'],
    drug_class: 'exon_skipping_therapy',
    disease_categories: ['Doencas Neurologicas'],
  },
  {
    code: 'ATC:N03AX26',
    atc_code: 'N03AX26',
    atc_level_1: 'N',
    name: 'Cannabidiol',
    synonyms: ['Epidiolex'],
    drug_class: 'anticonvulsant',
    disease_categories: ['Doencas Neurologicas'],
  },
];

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
  const display = String(raw.display || raw.nome || raw.name || '').trim();

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
  const requirements = record?.validation_requirements && typeof record.validation_requirements === 'object'
    ? record.validation_requirements
    : {};

  return {
    orpha_code: normalizeOrphaCode(record.orpha_code),
    name: String(record.name || '').trim(),
    disease_category: String(record.disease_category || '').trim(),
    validation_requirements: requirements,
    drug_classes: Array.isArray(record.drug_classes) ? record.drug_classes : [],
  };
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

async function ensureMedicationDictionarySeeded(db) {
  const collection = db.collection('medication_dictionary');
  const count = await collection.estimatedDocumentCount();
  if (count > 0) {
    return;
  }

  const now = new Date();
  const operations = DEFAULT_MEDICATIONS.map((item) => ({
    updateOne: {
      filter: { code: item.code },
      upsert: true,
      update: {
        $set: {
          ...item,
          generic_name: item.name,
          active: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
    },
  }));
  await collection.bulkWrite(operations, { ordered: false });
}

async function ensureMedicationDictionaryIndexes(db) {
  const collection = db.collection('medication_dictionary');
  await collection.createIndex({ generic_name: 1 }, { name: 'generic_name_idx' });
  await collection.createIndex({ atc_code: 1 }, { name: 'atc_code_idx' });
  await collection.createIndex({ name: 'text', generic_name: 'text', synonyms: 'text', code: 'text', atc_code: 'text' }, { name: 'medication_text_idx' });
  await collection.createIndex({ drug_class: 1 }, { name: 'drug_class_idx' });
  await collection.createIndex({ disease_categories: 1 }, { name: 'disease_categories_idx' });
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
    await ensureMedicationDictionarySeeded(db);
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
      { query: String(query).trim() }
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
  const cacheKey = `orpha:suggest:${orphaCode}`;
  try {
    const cached = await getCacheValue(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
    const driver = getNeo4jDriver();
    const session = driver.session();
    // Cypher: busca HPOs e Biomarcadores relacionados
    const cypher = `
      MATCH (d:Doenca_ORPHA {code: $orphaCode})
      OPTIONAL MATCH (d)-[:APRESENTA_FENOTIPO]->(h:Fenotipo_HPO)
      OPTIONAL MATCH (d)-[:POSSUI_BIOMARCADOR]->(b:Biomarcador)
      RETURN d, collect(DISTINCT h) as fenotipos, collect(DISTINCT b) as biomarcadores
    `;
    const result = await session.run(cypher, { orphaCode });
    await session.close();
    if (!result.records.length) return res.status(404).json({ error: 'Not found' });
    const d = result.records[0].get('d').properties;
    const phenotypes = result.records[0].get('fenotipos')
      .map((h) => (h && h.properties ? normalizeCoding({
        system: 'http://purl.obolibrary.org/obo/hp.owl',
        code: h.properties.code,
        display: h.properties.nome || h.properties.name,
      }, 'http://purl.obolibrary.org/obo/hp.owl') : null))
      .filter(Boolean);
    const biomarkers = result.records[0].get('biomarcadores')
      .map((b) => (b && b.properties ? normalizeCoding({
        system: 'http://loinc.org',
        code: b.properties.code || b.properties.nome,
        display: b.properties.nome || b.properties.name,
      }, 'http://loinc.org') : null))
      .filter(Boolean);

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
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    await ensureMedicationDictionarySeeded(db);
    const collection = db.collection('medication_dictionary');

    const filters = [{ active: { $ne: false } }];
    if (query) {
      const regex = new RegExp(query, 'i');
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
