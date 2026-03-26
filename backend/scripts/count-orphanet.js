// Script para contar registros Orphanet por idioma no banco local
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
const COLLECTION = 'orphanet_diseases';

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  const counts = await col.aggregate([
    { $group: { _id: '$lang', count: { $sum: 1 } } }
  ]).toArray();
  await client.close();
  console.log('Contagem de registros Orphanet por idioma:');
  counts.forEach(c => console.log(`${c._id}: ${c.count}`));
}

main().catch(e => { console.error(e); process.exit(1); });
