// backend/src/services/hpoService.js
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
const COLLECTION = 'hpo_terms';
const HPO_API_URL = 'https://ontology.jax.org/api/hp/search?q=';

async function searchHpoLocal(query) {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const regex = new RegExp(query, 'i');
  const results = await col.find({
    $or: [
      { label: regex },
      { hpoId: regex },
      { synonyms: regex }
    ],
    isObsolete: { $ne: true }
  }).limit(20).toArray();
  await client.close();
  return results;
}

async function searchHpoExternal(query) {
  const url = `${HPO_API_URL}${encodeURIComponent(query)}&rows=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erro ao buscar na API HPO');
  const data = await res.json();
  return (data?.response?.docs || []).map(doc => ({
    hpoId: doc.id,
    label: doc.label,
    synonyms: doc.synonym,
    definition: doc.definition,
    isObsolete: doc.is_obsolete
  }));
}

module.exports = { searchHpoLocal, searchHpoExternal };
