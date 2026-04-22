// Script de migração para modularizar pacientes existentes
// Execute com: node backend/scripts/migrate-patients-to-modular.js

const { MongoClient } = require('mongodb');
const PatientModel = require('../src/models/Patient');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bioavanced';
const DB_NAME = process.env.DB_NAME || 'bioavanced';

async function migrate() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const patients = db.collection('patients');

    const cursor = patients.find({ $or: [
      { anamneseGeral: { $exists: false } },
      { dadosEspecificos: { $exists: false } }
    ] });

    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      // Usa o model para gerar a nova estrutura
      const novo = PatientModel.create(doc);
      await patients.updateOne(
        { _id: doc._id },
        { $set: {
            anamneseGeral: novo.anamneseGeral,
            dadosEspecificos: novo.dadosEspecificos
          }
        }
      );
      count++;
    }
    console.log(`Migração concluída. Pacientes atualizados: ${count}`);
  } catch (err) {
    console.error('Erro na migração:', err);
  } finally {
    await client.close();
  }
}

migrate();
