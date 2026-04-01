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
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  // Busca por nome ou código (case-insensitive)
  const regex = new RegExp(q, 'i');
  const results = await col.find({
    lang,
    $or: [
      { name: regex },
      { code: regex },
      { synonyms: regex }
    ]
  }).limit(20).toArray();
  await client.close();
  res.json(results);
});

module.exports = router;
