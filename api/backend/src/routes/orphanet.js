// Endpoint REST para busca de doenças Orphanet
const express = require('express');
const router = express.Router();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'bioavance';
const COLLECTION = 'orphanet_diseases';

// GET /api/orphanet/search?q=nome&lang=pt
router.get('/search', async (req, res) => {
  const { q, lang = 'pt' } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);
    // Busca por nome, código ou sinônimo (case-insensitive).
    const regex = new RegExp(q, 'i');
    const baseFilter = {
      $or: [
        { name: regex },
        { code: regex },
        { synonyms: regex },
      ],
    };

    const requestedLang = String(lang || '').trim().toLowerCase();
    let results = [];

    if (requestedLang) {
      results = await col.find({ ...baseFilter, lang: requestedLang }).limit(20).toArray();
    }

    if (!Array.isArray(results) || results.length === 0) {
      results = await col.find(baseFilter).limit(20).toArray();
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search orphanet diseases' });
  } finally {
    await client.close();
  }
});

module.exports = router;
