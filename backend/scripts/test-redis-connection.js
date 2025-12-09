/**
 * Script de Teste de Conexão Redis
 * Usa o pacote 'redis' (oficial) para testar conexão
 * Usa a mesma configuração da aplicação (env.js)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_USERNAME,
  REDIS_TLS,
} = require('../src/config/env');

async function testRedisConnection() {
  let client = null;

  try {
    // Validação
    if (!REDIS_HOST) {
      throw new Error('[ERROR] Variável REDIS_HOST não definida no .env');
    }

    if (!REDIS_PORT) {
      throw new Error('[ERROR] Variável REDIS_PORT não definida no .env');
    }

    if (!REDIS_PASSWORD) {
      throw new Error('[ERROR] Variável REDIS_PASSWORD não definida no .env');
    }

    // Importa o pacote redis
    const { createClient } = require('redis');

    // Configuração do cliente Redis (mesma da aplicação)
    const redisConfig = {
      username: REDIS_USERNAME || 'default',
      password: REDIS_PASSWORD,
      socket: {
        host: REDIS_HOST,
        port: Number(REDIS_PORT),
        tls: REDIS_TLS,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('❌ Muitas tentativas de reconexão, abortando...');
            return new Error('Muitas tentativas de reconexão');
          }
          return Math.min(retries * 50, 1000);
        }
      }
    };

    console.log('[INFO] 🔍 Config Redis:');
    console.log(`   host: ${redisConfig.socket.host}`);
    console.log(`   port: ${redisConfig.socket.port}`);
    console.log(`   username: ${redisConfig.username}`);
    console.log(`   tls: ${redisConfig.socket.tls}`);
    console.log(`   hasPassword: ${!!redisConfig.password}`);

    // Validação básica
    if (!redisConfig.socket.host) {
      throw new Error('REDIS_HOST não está definido no .env');
    }

    if (!redisConfig.socket.port) {
      throw new Error('REDIS_PORT não está definido no .env');
    }

    // Cria cliente Redis
    console.log('\n🔗 Criando cliente Redis...');
    client = createClient(redisConfig);

    // Event listeners
    client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err.message);
    });

    client.on('connect', () => {
      console.log('✅ Redis conectando...');
    });

    client.on('ready', () => {
      console.log('✅ Redis pronto para uso');
    });

    client.on('reconnecting', () => {
      console.log('🔄 Redis reconectando...');
    });

    // Conecta ao Redis
    console.log('🔄 Conectando ao Redis...');
    await client.connect();
    console.log('✅ Conectado ao Redis com sucesso!');

    // Teste de escrita e leitura
    console.log('\n📝 Testando escrita e leitura...');
    await client.set('foo', 'bar');
    console.log('✅ Valor escrito: foo = bar');

    const result = await client.get('foo');
    console.log(`✅ Valor lido: foo = ${result}`);

    if (result === 'bar') {
      console.log('\n✅ Teste de conexão Redis: SUCESSO!');
      console.log('   - Conexão estabelecida');
      console.log('   - Escrita funcionando');
      console.log('   - Leitura funcionando');
    } else {
      throw new Error(`Valor esperado 'bar', mas recebido '${result}'`);
    }

    // Limpa o valor de teste
    await client.del('foo');
    console.log('✅ Valor de teste removido');

    return true;
  } catch (error) {
    console.error('\n❌ Erro ao testar conexão Redis:');
    console.error(`   ${error.message}`);
    
    if (error.code) {
      console.error(`   Código: ${error.code}`);
    }
    
    if (error.stack) {
      console.error('\n📋 Stack trace:');
      console.error(error.stack);
    }

    return false;
  } finally {
    // Fecha conexão
    if (client && client.isOpen) {
      try {
        await client.quit();
        console.log('\n✅ Conexão Redis fechada');
      } catch (closeError) {
        console.error('⚠️ Erro ao fechar conexão:', closeError.message);
      }
    }
  }
}

// Executa teste
if (require.main === module) {
  testRedisConnection()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Erro fatal:', error);
      process.exit(1);
    });
}

module.exports = { testRedisConnection };

