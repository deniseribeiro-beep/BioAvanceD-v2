// Script para importar doenças Orphanet do XML para MongoDB
// Uso: node import-orphanet.js <caminho_xml> <idioma: pt|es|en>

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const xml2js = require('xml2js');

// Prioriza uso local de dev (env.docker)
const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/bioavanced?retryWrites=true&w=majority&tls=false';
const MONGO_URI = process.env.MONGO_URI || DEFAULT_MONGO_URI;
const DB_NAME = process.env.MONGO_DB || process.env.DB_NAME || 'bioavanced';
const COLLECTION = 'orphanet_diseases';

async function parseOrphanetXML(xmlPath, lang) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xml);
  // Aceita root JDBOR ou JDBORPHANET
  const root = result.JDBORPHANET || result.JDBOR;
  if (!root) return [];
  const disorders = root.DisorderList?.[0]?.Disorder || [];
  return disorders.map((d) => ({
    code: d.OrphaCode?.[0] || null,
    name: Array.isArray(d.Name) ? d.Name[0]._ || d.Name[0] : null,
    synonyms: Array.isArray(d.SynonymList?.[0]?.Synonym)
      ? d.SynonymList[0].Synonym.map(s => (typeof s === 'string' ? s : s._ || ''))
      : [],
    lang,
  }));
}

async function main() {
  const [,, xmlPath, lang] = process.argv;
  if (!xmlPath || !lang) {
    console.error('Uso: node import-orphanet.js <caminho_xml> <idioma: pt|es|en>');
    console.error('Exemplo local dev: node backend/scripts/import-orphanet.js data/pt_orphanet_classification.xml pt');
    console.error('Para customizar conexão, defina MONGO_URI e MONGO_DB no ambiente.');
    process.exit(1);
  }
  const diseases = await parseOrphanetXML(xmlPath, lang);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection(COLLECTION);
  // Remove antigos do mesmo idioma
  await col.deleteMany({ lang });
  // Insere novos
  if (diseases.length) await col.insertMany(diseases);
  console.log(`Importados ${diseases.length} doenças Orphanet (${lang})`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
