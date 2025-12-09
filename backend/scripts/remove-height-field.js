/**
 * Script de migração para remover o campo 'height' duplicado da coleção de pacientes
 * Converte 'height' (metros) para 'heightCm' (centímetros) se necessário
 * 
 * Uso: node backend/scripts/remove-height-field.js
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env' });

// Usa a mesma configuração do servidor
const env = require('../src/config/env');
const MONGODB_URI = env.MONGO_URI;
const MONGODB_DB = env.MONGO_DB || 'bioadvance';

async function removeHeightField() {
  let client;
  
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGO_URI não está configurada no arquivo .env');
    }
    
    console.log('Conectando ao MongoDB...');
    console.log(`URI: ${MONGODB_URI.replace(/:[^:@]+@/, ':****@')}`); // Oculta senha
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✓ Conectado ao MongoDB');
    
    const db = client.db(MONGODB_DB);
    const pacientesCollection = db.collection('pacientes');
    
    // Encontra pacientes com o campo 'height'
    const patientsWithHeight = await pacientesCollection.find({ height: { $exists: true } }).toArray();
    console.log(`\nEncontrados ${patientsWithHeight.length} pacientes com o campo 'height'`);
    
    if (patientsWithHeight.length === 0) {
      console.log('✓ Nenhum paciente com campo "height" encontrado. Nada a fazer.');
      return;
    }
    
    let converted = 0;
    let removed = 0;
    
    for (const patient of patientsWithHeight) {
      const update = {};
      
      // Se o paciente tem 'height' mas não tem 'heightCm', converte
      if (patient.height !== undefined && patient.height !== null && !patient.heightCm) {
        const heightValue = parseFloat(patient.height);
        if (!isNaN(heightValue) && heightValue > 0) {
          // Se o valor for menor que 3, assume que está em metros e converte para cm
          const heightCm = heightValue < 3 ? heightValue * 100 : heightValue;
          update.$set = { heightCm: heightCm };
          update.$unset = { height: '' };
          converted++;
        } else {
          // Valor inválido, apenas remove
          update.$unset = { height: '' };
          removed++;
        }
      } else {
        // Já tem heightCm ou height é inválido, apenas remove height
        update.$unset = { height: '' };
        removed++;
      }
      
      await pacientesCollection.updateOne(
        { _id: patient._id },
        update
      );
    }
    
    console.log(`\n✓ Migração concluída:`);
    console.log(`  - ${converted} pacientes tiveram 'height' convertido para 'heightCm'`);
    console.log(`  - ${removed} pacientes tiveram 'height' removido`);
    console.log(`\n✓ Total de ${patientsWithHeight.length} pacientes atualizados`);
    
    // Verifica se ainda há pacientes com 'height'
    const remaining = await pacientesCollection.countDocuments({ height: { $exists: true } });
    if (remaining > 0) {
      console.log(`\n⚠️  Ainda existem ${remaining} pacientes com o campo 'height'`);
    } else {
      console.log(`\n✓ Todos os pacientes foram migrados com sucesso!`);
    }
    
  } catch (error) {
    console.error('Erro durante a migração:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n✓ Conexão fechada');
    }
  }
}

// Executa a migração
removeHeightField()
  .then(() => {
    console.log('\n✓ Script concluído com sucesso');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Erro fatal:', error);
    process.exit(1);
  });

