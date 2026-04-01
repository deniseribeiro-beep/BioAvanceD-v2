// backend/scripts/import-hpo.js
// Script para importar termos HPO da API oficial para MongoDB
// Uso: node backend/scripts/import-hpo.js

const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
const COLLECTION = 'hpo_terms';
const HPO_API_URL = 'https://ontology.jax.org/api/hp/search?q=*&rows=10000';

async function fetchAllHpoTerms() {
  const res = await fetch(HPO_API_URL);
  if (!res.ok) throw new Error('Erro ao buscar termos HPO');
  const data = await res.json();
  return (data?.response?.docs || []).map(doc => ({
    hpoId: doc.id,
    label: doc.label,
    synonyms: doc.synonym,
    definition: doc.definition,
    isObsolete: doc.is_obsolete,
    updatedAt: new Date()
  }));
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const terms = await fetchAllHpoTerms();
  await col.deleteMany({});
  if (terms.length) await col.insertMany(terms);
  await col.updateOne({}, { $set: { lastSync: new Date() } }, { upsert: true });
  await client.close();
  console.log(`Importados ${terms.length} termos HPO.`);
}

main().catch(e => { console.error(e); process.exit(1); });
