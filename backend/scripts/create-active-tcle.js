// Script para criar um TCLE ativo de teste no banco MongoDB
// Uso: node backend/scripts/create-active-tcle.js

const { MongoClient } = require('mongodb');

// Usa sempre o MongoDB local padrão
const uri = 'mongodb://localhost:27017';
const dbName = 'bioavance';

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('consenttemplates');

    // Desativa todos os TCLEs ativos
    await collection.updateMany({ active: true }, { $set: { active: false } });

    // Cria um novo TCLE ativo
    const tcle = {
      name: 'TCLE Teste',
      body: 'Termo de Consentimento Livre e Esclarecido para testes.',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await collection.insertOne(tcle);
    console.log('TCLE ativo criado com _id:', result.insertedId);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Erro ao criar TCLE ativo:', err);
  process.exit(1);
});
