// Endpoint para consultar a contagem de doenças Orphanet por idioma
const express = require('express');
const router = express.Router();

const COLLECTION = 'orphanet_diseases';

// GET /api/orphanet-count/count
router.get('/count', async (req, res) => {
  try {
    // Usa conexão existente do app se disponível
    const db = req.app && req.app.locals && req.app.locals.db
      ? req.app.locals.db
      : null;
    let client, database;
    if (!db) {
      // fallback: cria conexão própria
      const { MongoClient } = require('mongodb');
      const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
      const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
      client = new MongoClient(MONGO_URI);
      await client.connect();
      database = client.db(DB_NAME);
    }
    try {
      const col = (db || database).collection(COLLECTION);
      const counts = await col.aggregate([
        { $group: { _id: '$lang', count: { $sum: 1 } } }
      ]).toArray();
      res.json(counts);
    } finally {
      if (client) await client.close();
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
