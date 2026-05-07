// backend/src/routes/hpo.js
const express = require('express');
const router = express.Router();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
const COLLECTION = 'hpo_terms';


// GET /api/hpo/search?q=termo
const { searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled } = require('../services/hpoService');
const logger = require('../utils/logger');
router.get('/search', async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.status(400).json({ error: 'Missing query' });
  try {
    let results = await searchHpoLocal(q);
    if ((!results || results.length === 0) && isExternalHpoLookupEnabled()) {
      logger.warn(`[HPO] Fallback para API externa para query: ${q}`);
      results = await searchHpoExternal(q);
    }
    logger.info(`[HPO] Busca por "${q}" retornou ${results.length} resultados (local${results && results.length ? '' : ' + fallback'})`);
    res.json(results);
  } catch (err) {
    logger.error(`[HPO] Erro na busca local por "${q}": ${err.message}`);
    try {
      if (!isExternalHpoLookupEnabled()) {
        return res.json([]);
      }
      const results = await searchHpoExternal(q);
      logger.warn(`[HPO] Fallback por erro local para API externa para query: ${q}`);
      res.json(results);
    } catch (err2) {
      logger.error(`[HPO] Erro também na API externa para "${q}": ${err2.message}`);
      res.status(500).json({ error: 'Erro ao buscar termos HPO' });
    }
  }
});

// GET /api/hpo/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const term = await col.findOne({ hpoId: id });
  await client.close();
  if (!term) return res.status(404).json({ error: 'Not found' });
  res.json(term);
});

module.exports = router;
