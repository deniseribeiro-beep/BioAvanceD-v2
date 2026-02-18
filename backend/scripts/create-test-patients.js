#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB || 'bioavanced';

function generatePatientID() {
  // Gera um ID de 8 dígitos aleatório
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

(async () => {
  const client = new MongoClient(uri);
  try {
    console.log('Conectando ao MongoDB...');
    await client.connect();
    const db = client.db(dbName);
    const patientsCollection = db.collection('pacientes');
    
    console.log('Criando pacientes de teste com status PENDING_CONSENT...');
    
    const patients = [];
    for (let i = 0; i < 5; i++) {
      patients.push({
        patientID: generatePatientID(),
        status: 'PENDING_CONSENT',
        consentToken: crypto.randomBytes(32).toString('hex'),
        consentNotifiedAt: new Date(),
        consentTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    
    const result = await patientsCollection.insertMany(patients);
    
    console.log(`✅ ${result.insertedCount} pacientes criados!`);
    patients.forEach((p, idx) => {
      console.log(`${idx + 1}. ID: ${p.patientID}, Status: ${p.status}`);
    });
  } catch(e) {
    console.error('❌ Erro:', e.message);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
})();
