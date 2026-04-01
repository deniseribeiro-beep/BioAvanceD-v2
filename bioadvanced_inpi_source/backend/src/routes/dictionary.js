// backend/src/routes/dictionary.js
const express = require('express');
const router = express.Router();
const redis = require('redis');
const { getNeo4jDriver } = require('../database/neo4j');

// Redis client (assume redis running on default port)
const redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect();

function normalizeCoding(raw = {}, fallbackSystem) {
  const system = String(raw.system || fallbackSystem || '').trim();
  const code = String(raw.code || '').trim();
  const display = String(raw.display || raw.nome || raw.name || '').trim();

  if (!system || !code || !display) {
    return null;
  }

  return { system, code, display };
}

// Busca ORPHA/HPO com cache
router.get('/search', async (req, res) => {
  const { query = '' } = req.query;
  if (!query.trim()) return res.status(400).json({ error: 'Missing query' });
  const cacheKey = `orpha:search:${String(query).toLowerCase()}`;
  try {
    // 1. Tenta cache
    const cached = await redisClient.get(cacheKey);
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

    await redisClient.setEx(cacheKey, 3600, JSON.stringify(payload));
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
    const cached = await redisClient.get(cacheKey);
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

    await redisClient.setEx(cacheKey, 3600, JSON.stringify(response));
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
