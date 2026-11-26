// backend/src/routes/hpo.js
const express = require('express');
const { authenticate } = require('../infrastructure/middleware/auth');

const router = express.Router();

const COLLECTION = 'hpo_terms';


// GET /api/hpo/search?q=termo
const { searchHpoLocal, searchHpoExternal, isExternalHpoLookupEnabled } = require('../services/hpoService');
const logger = require('../utils/logger');
router.get('/search', authenticate, async (req, res) => {
  const { q = '' } = req.query;
  if (typeof q !== 'string') return res.status(400).json({ error: 'Invalid query' });
  if (!q.trim()) return res.status(400).json({ error: 'Missing query' });
  try {
    let results = await searchHpoLocal(q, req.app.locals.db);
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
      logger.info(`[HPO] Busca por "${q}" retornou ${results.length} resultados (fallback externo após erro local)`);
      res.json(results);
    } catch (err2) {
      logger.error(`[HPO] Erro também na API externa para "${q}": ${err2.message}`);
      res.status(500).json({ error: 'Erro ao buscar termos HPO' });
    }
  }
});

// GET /api/hpo/:id
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  // #834: this had no try/catch, so a rejected findOne -- Mongo unreachable, a
  // driver timeout, a topology change -- was an unhandled promise rejection,
  // and Node answers those by exiting the process. A brief database blip took
  // the whole API down rather than failing this one endpoint. Found by the
  // sweep #829 asked for; GET /search above has had a try/catch all along.
  try {
    const db = req.app.locals.db;
    const col = db.collection(COLLECTION);
    const term = await col.findOne({ hpoId: id });
    if (!term) return res.status(404).json({ error: 'Not found' });
    return res.json(term);
  } catch (err) {
    logger.error(`[HPO] Erro ao buscar termo "${id}": ${err.message}`);
    return res.status(500).json({ error: 'Erro ao buscar termo HPO' });
  }
});

module.exports = router;
