require('dotenv').config();
const { MongoClient } = require('mongodb');

/**
 * Script para testar a conexão com MongoDB e diagnosticar problemas
 */
async function testConnection() {
  console.log('🔍 Testando conexão com MongoDB...\n');

  // Verifica variáveis de ambiente
  const mongoURI = process.env.MONGO_URI;
  const mongoDB = process.env.MONGO_DB;

  if (!mongoURI) {
    console.error('❌ MONGO_URI não está definida no arquivo .env');
    process.exit(1);
  }

  if (!mongoDB) {
    console.error('❌ MONGO_DB não está definida no arquivo .env');
    process.exit(1);
  }

  console.log('📋 Configurações detectadas:');
  console.log('   - MONGO_URI:', mongoURI.replace(/:([^@]+)@/, ':****@'));
  console.log('   - MONGO_DB:', mongoDB);
  console.log('');

  // Extrai informações da URI
  const uriPattern = /^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@(.+)$/;
  const match = mongoURI.match(uriPattern);

  if (match) {
    const [, protocol, username, password] = match;
    console.log('📋 Informações da URI:');
    console.log('   - Protocolo:', protocol);
    console.log('   - Usuário:', username);
    console.log('   - Senha (tamanho):', password.length, 'caracteres');
    console.log('   - Senha contém caracteres especiais:', /[@#%&?=]/.test(password) ? 'Sim' : 'Não');
    console.log('   - Senha parece codificada:', password.includes('%') ? 'Sim' : 'Não');
    console.log('');
  }

  // Testa conexão com URI original
  console.log('🔄 Tentando conectar com URI original...');
  try {
    const client1 = new MongoClient(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    await client1.connect();
    const db1 = client1.db(mongoDB);
    
    // Tenta uma operação simples
    await db1.admin().ping();
    
    console.log('✅ Conexão bem-sucedida com URI original!');
    await client1.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro com URI original:', error.message);
    console.log('');
  }

  // Testa conexão com URI codificada
  if (match) {
    const [, protocol, username, password, rest] = match;
    const encodedPassword = encodeURIComponent(password);
    const encodedURI = `${protocol}${username}:${encodedPassword}@${rest}`;

    console.log('🔄 Tentando conectar com URI codificada...');
    try {
      const client2 = new MongoClient(encodedURI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });

      await client2.connect();
      const db2 = client2.db(mongoDB);
      
      // Tenta uma operação simples
      await db2.admin().ping();
      
      console.log('✅ Conexão bem-sucedida com URI codificada!');
      console.log('💡 Use a URI codificada no seu arquivo .env');
      await client2.close();
      process.exit(0);
    } catch (error) {
      console.error('❌ Erro com URI codificada:', error.message);
      console.log('');
    }
  }

  // Se chegou aqui, nenhuma tentativa funcionou
  console.error('❌ Não foi possível conectar ao MongoDB com nenhuma das tentativas');
  console.log('');
  console.log('💡 Dicas para resolver:');
  console.log('   1. Verifique se o usuário e senha estão corretos');
  console.log('   2. Verifique se o IP está na whitelist do MongoDB Atlas');
  console.log('   3. Verifique se o usuário tem permissões adequadas');
  console.log('   4. Se a senha contém caracteres especiais, tente codificá-los manualmente');
  console.log('      Exemplo: @ → %40, # → %23, % → %25');
  
  process.exit(1);
}

testConnection().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});

