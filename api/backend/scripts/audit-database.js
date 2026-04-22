require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB, connectNewDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

/**
 * Script de auditoria completa do banco de dados
 * Mostra todas as variáveis, coleções, estruturas e estatísticas
 */
async function auditDatabase() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 AUDITORIA COMPLETA DO BANCO DE DADOS');
    console.log('='.repeat(80));
    console.log('');

    // ============================================
    // 1. VARIÁVEIS DE AMBIENTE
    // ============================================
    console.log('📋 1. VARIÁVEIS DE AMBIENTE');
    console.log('-'.repeat(80));
    console.log('NODE_ENV:', process.env.NODE_ENV || 'não definido');
    console.log('PORT:', process.env.PORT || 'não definido');
    console.log('MONGO_URI:', process.env.MONGO_URI ? process.env.MONGO_URI.replace(/:([^@]+)@/, ':****@') : 'não definido');
    console.log('MONGO_DB:', process.env.MONGO_DB || 'não definido');
    console.log('MONGO_DB_NOVO:', process.env.MONGO_DB_NOVO || 'não definido');
    console.log('JWT_SECRET:', process.env.JWT_SECRET ? '***definido***' : 'não definido');
    console.log('');

    // ============================================
    // 2. INFORMAÇÕES DA CONEXÃO
    // ============================================
    console.log('📡 2. INFORMAÇÕES DA CONEXÃO');
    console.log('-'.repeat(80));

    // Conecta ao banco principal
    console.log('Conectando ao banco principal:', process.env.MONGO_DB);
    const db = await connectDB();
    
    const adminDb = db.admin();
    const serverStatus = await adminDb.serverStatus();
    const buildInfo = await adminDb.buildInfo();

    console.log('✅ Conectado ao MongoDB');
    console.log('   - Host:', serverStatus.host);
    console.log('   - Versão:', buildInfo.version);
    console.log('   - Plataforma:', buildInfo.targetMinOS);
    console.log('   - Arquitetura:', buildInfo.bits === 64 ? '64-bit' : '32-bit');
    console.log('   - Uptime:', Math.floor(serverStatus.uptime / 3600), 'horas');
    console.log('');

    // ============================================
    // 3. BANCO DE DADOS PRINCIPAL
    // ============================================
    console.log('📊 3. BANCO DE DADOS PRINCIPAL:', process.env.MONGO_DB);
    console.log('-'.repeat(80));

    const collections = await db.listCollections().toArray();
    console.log(`Total de coleções: ${collections.length}`);
    console.log('');

    if (collections.length === 0) {
      console.log('⚠️  Nenhuma coleção encontrada no banco principal');
    } else {
      for (const collectionInfo of collections) {
        const collectionName = collectionInfo.name;
        const collection = db.collection(collectionName);
        
        // Estatísticas da coleção
        const count = await collection.countDocuments();
        let stats = null;
        try {
          stats = await db.command({ collStats: collectionName });
        } catch (e) {
          // Se não conseguir obter stats, continua sem eles
        }
        
        console.log(`📁 Coleção: ${collectionName}`);
        console.log(`   - Documentos: ${count.toLocaleString()}`);
        if (stats) {
          console.log(`   - Tamanho: ${(stats.size / 1024).toFixed(2)} KB`);
          console.log(`   - Tamanho em disco: ${(stats.storageSize / 1024).toFixed(2)} KB`);
          console.log(`   - Índices: ${stats.nindexes || 0}`);
        }
        
        // Lista índices
        const indexes = await collection.indexes();
        if (indexes.length > 0) {
          console.log('   - Índices:');
          indexes.forEach((idx, i) => {
            const keys = Object.keys(idx.key).map(k => `${k}:${idx.key[k]}`).join(', ');
            console.log(`     ${i + 1}. {${keys}} ${idx.unique ? '(único)' : ''} ${idx.sparse ? '(esparso)' : ''}`);
          });
        }

        // Amostra de estrutura (primeiros 3 documentos)
        if (count > 0) {
          const sampleDocs = await collection.find({}).limit(1).toArray();
          if (sampleDocs.length > 0) {
            console.log('   - Estrutura do documento (amostra):');
            const firstDoc = sampleDocs[0];
            const structure = analyzeDocumentStructure(firstDoc);
            structure.forEach(line => console.log(`     ${line}`));
          }
        }
        console.log('');
      }
    }

    // ============================================
    // 4. BANCO DE DADOS NOVO
    // ============================================
    console.log('📊 4. BANCO DE DADOS NOVO:', process.env.MONGO_DB_NOVO);
    console.log('-'.repeat(80));

    try {
      const newDb = await connectNewDB();
      const newCollections = await newDb.listCollections().toArray();
      console.log(`Total de coleções: ${newCollections.length}`);
      console.log('');

      if (newCollections.length === 0) {
        console.log('⚠️  Nenhuma coleção encontrada no banco novo');
      } else {
        for (const collectionInfo of newCollections) {
          const collectionName = collectionInfo.name;
          const collection = newDb.collection(collectionName);
          
          const count = await collection.countDocuments();
          let stats = null;
          try {
            stats = await newDb.command({ collStats: collectionName });
          } catch (e) {
            // Se não conseguir obter stats, continua sem eles
          }
          
          console.log(`📁 Coleção: ${collectionName}`);
          console.log(`   - Documentos: ${count.toLocaleString()}`);
          if (stats) {
            console.log(`   - Tamanho: ${(stats.size / 1024).toFixed(2)} KB`);
            console.log(`   - Tamanho em disco: ${(stats.storageSize / 1024).toFixed(2)} KB`);
            console.log(`   - Índices: ${stats.nindexes || 0}`);
          }
          
          const indexes = await collection.indexes();
          if (indexes.length > 0) {
            console.log('   - Índices:');
            indexes.forEach((idx, i) => {
              const keys = Object.keys(idx.key).map(k => `${k}:${idx.key[k]}`).join(', ');
              console.log(`     ${i + 1}. {${keys}} ${idx.unique ? '(único)' : ''} ${idx.sparse ? '(esparso)' : ''}`);
            });
          }

          if (count > 0) {
            const sampleDocs = await collection.find({}).limit(1).toArray();
            if (sampleDocs.length > 0) {
              console.log('   - Estrutura do documento (amostra):');
              const firstDoc = sampleDocs[0];
              const structure = analyzeDocumentStructure(firstDoc);
              structure.forEach(line => console.log(`     ${line}`));
            }
          }
          console.log('');
        }
      }
    } catch (error) {
      console.log(`❌ Erro ao acessar banco novo: ${error.message}`);
      console.log('');
    }

    // ============================================
    // 5. RESUMO GERAL
    // ============================================
    console.log('📈 5. RESUMO GERAL');
    console.log('-'.repeat(80));
    
    const mainDbStats = await db.stats();
    console.log('Banco Principal:', process.env.MONGO_DB);
    console.log(`   - Tamanho total: ${(mainDbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   - Tamanho em disco: ${(mainDbStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   - Total de coleções: ${mainDbStats.collections}`);
    console.log(`   - Total de documentos: ${mainDbStats.objects.toLocaleString()}`);
    console.log('');

    try {
      const newDb = await connectNewDB();
      const newDbStats = await newDb.stats();
      console.log('Banco Novo:', process.env.MONGO_DB_NOVO);
      console.log(`   - Tamanho total: ${(newDbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - Tamanho em disco: ${(newDbStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - Total de coleções: ${newDbStats.collections}`);
      console.log(`   - Total de documentos: ${newDbStats.objects.toLocaleString()}`);
    } catch (error) {
      console.log('Banco Novo: Não foi possível obter estatísticas');
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Auditoria concluída com sucesso!');
    console.log('='.repeat(80));

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro na auditoria:', error.message);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Analisa a estrutura de um documento e retorna uma representação formatada
 */
function analyzeDocumentStructure(doc, prefix = '', depth = 0) {
  if (depth > 3) return ['... (profundidade máxima atingida)'];
  
  const lines = [];
  const keys = Object.keys(doc);
  
  for (const key of keys) {
    const value = doc[key];
    const valueType = getValueType(value);
    
    // Trata ObjectId especialmente
    if (key === '_id' && value && typeof value.toString === 'function' && value.constructor && value.constructor.name === 'ObjectId') {
      lines.push(`${prefix}${key}: ObjectId = ObjectId("${value.toString()}")`);
      continue;
    }
    
    // Verifica se é ObjectId de outra forma
    if (valueType === 'ObjectId' && value && typeof value.toString === 'function') {
      lines.push(`${prefix}${key}: ObjectId = ObjectId("${value.toString()}")`);
      continue;
    }
    
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
    const isArray = Array.isArray(value);
    
    if (isObject) {
      // Evita mostrar buffers internos do ObjectId
      if (value.buffer && value.constructor && value.constructor.name === 'ObjectId') {
        lines.push(`${prefix}${key}: ObjectId = ObjectId("${value.toString()}")`);
      } else {
        lines.push(`${prefix}${key}: {`);
        const nested = analyzeDocumentStructure(value, prefix + '  ', depth + 1);
        lines.push(...nested);
        lines.push(`${prefix}}`);
      }
    } else if (isArray && value.length > 0) {
      lines.push(`${prefix}${key}: [${valueType}] (${value.length} itens)`);
      if (value[0] && typeof value[0] === 'object' && !(value[0] instanceof Date)) {
        lines.push(`${prefix}  [0]: {`);
        const nested = analyzeDocumentStructure(value[0], prefix + '    ', depth + 1);
        lines.push(...nested);
        lines.push(`${prefix}  }`);
      } else {
        lines.push(`${prefix}  [0]: ${valueType}`);
      }
    } else {
      let displayValue;
      if (value instanceof Date) {
        displayValue = `Date(${value.toISOString()})`;
      } else if (value === null) {
        displayValue = 'null';
      } else if (typeof value === 'string' && value.length > 50) {
        displayValue = `"${value.substring(0, 50)}..."`;
      } else if (typeof value === 'string') {
        displayValue = `"${value}"`;
      } else {
        displayValue = value;
      }
      lines.push(`${prefix}${key}: ${valueType} = ${displayValue}`);
    }
  }
  
  return lines;
}

/**
 * Retorna o tipo de um valor de forma legível
 */
function getValueType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'Array';
  if (value instanceof Date) return 'Date';
  // Verifica se é ObjectId do MongoDB
  if (value && value.constructor && value.constructor.name === 'ObjectId') return 'ObjectId';
  // Verifica se é ObjectId pelo formato (tem toString e toHexString)
  if (value && typeof value.toString === 'function' && typeof value.toHexString === 'function') {
    return 'ObjectId';
  }
  return typeof value;
}

// Executa a auditoria
auditDatabase();

