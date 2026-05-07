const { MongoClient } = require('mongodb');
const env = require('../config/env');

let client = null;
let db = null;
let newDb = null;

/**
 * Garante que a URI tenha database e parametros basicos (tls, retryWrites, w)
 * @param {string} uri
 * @param {string} dbName
 * @returns {string}
 */
function ensureMongoUri(uri, dbName) {
  if (!uri) return uri;

  const parts = uri.split('?');
  let base = parts[0];
  const query = parts[1] || '';

  const protocolIndex = base.indexOf('://');
  if (protocolIndex === -1) return uri;

  const pathStart = base.indexOf('/', protocolIndex + 3);
  if (pathStart === -1) {
    base = `${base}/${dbName}`;
  } else if (pathStart === base.length - 1) {
    base = `${base}${dbName}`;
  }

  const params = new URLSearchParams(query);
  if (!params.has('retryWrites')) params.set('retryWrites', 'true');
  if (!params.has('w')) params.set('w', 'majority');
  if (!params.has('tls') && !params.has('ssl')) {
    const isSrvProtocol = base.startsWith('mongodb+srv://');
    params.set('tls', isSrvProtocol ? 'true' : 'false');
  }

  const paramString = params.toString();
  return paramString ? `${base}?${paramString}` : base;
}

function assertLocalMongoUri(uri) {
  const allowsCloud = env.ALLOW_CLOUD_INTEGRATIONS || process.env.ALLOW_CLOUD_INTEGRATIONS === 'true' || process.env.ALLOW_CLOUD_INTEGRATIONS === '1';
  if (!allowsCloud && String(uri || '').trim().toLowerCase().startsWith('mongodb+srv://')) {
    throw new Error('MONGO_URI cloud mongodb+srv:// desabilitada neste ambiente. Use MongoDB local/container ou ALLOW_CLOUD_INTEGRATIONS=true explicitamente.');
  }
}

/**
 * Codifica a senha na URI do MongoDB para evitar erros com caracteres especiais
 * @param {string} uri - URI do MongoDB
 * @param {boolean} debug - Se true, mostra logs de debug
 * @returns {string} URI com senha codificada
 */
function encodeMongoURI(uri, debug = false) {
  try {
    if (!uri) {
      return uri;
    }

    // Padrão para identificar a parte da senha na URI
    // Suporta mongodb:// e mongodb+srv://
    // mongodb+srv://usuario:senha@cluster... ou mongodb://usuario:senha@host...
    const uriPattern = /^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@(.+)$/;
    const match = uri.match(uriPattern);

    if (match) {
      const [, protocol, username, password, rest] = match;
      
      if (debug) {
        console.log('🔍 [DEBUG] URI original detectada');
        console.log('🔍 [DEBUG] Usuário:', username);
        console.log('🔍 [DEBUG] Senha (primeiros 3 chars):', password.substring(0, 3) + '***');
      }
      
      // Verifica se a senha já está codificada
      // Tenta decodificar e verificar se muda
      let isEncoded = false;
      try {
        const decoded = decodeURIComponent(password);
        isEncoded = (decoded !== password && password.includes('%'));
      } catch (e) {
        // Se não conseguir decodificar, provavelmente não está codificada
        isEncoded = false;
      }
      
      if (isEncoded) {
        if (debug) {
          console.log('🔍 [DEBUG] Senha já está codificada, usando URI original');
        }
        // Senha já está codificada, retorna a URI original
        return uri;
      }
      
      // Codifica apenas caracteres especiais que precisam ser codificados
      // encodeURIComponent codifica tudo, mas para senhas do MongoDB, alguns caracteres
      // podem não precisar de codificação dependendo da versão
      const encodedPassword = encodeURIComponent(password);
      
      if (debug) {
        console.log('🔍 [DEBUG] Senha codificada (primeiros 10 chars):', encodedPassword.substring(0, 10) + '***');
      }
      
      // Reconstrói a URI com a senha codificada
      const encodedURI = `${protocol}${username}:${encodedPassword}@${rest}`;
      
      if (debug) {
        console.log('🔍 [DEBUG] URI codificada (sem senha visível):', encodedURI.replace(/:([^@]+)@/, ':****@'));
      }
      
      return encodedURI;
    }

    // Se não corresponde ao padrão (pode ser URI sem autenticação), retorna a URI original
    if (debug) {
      console.log('🔍 [DEBUG] URI não corresponde ao padrão esperado (sem autenticação?)');
    }
    return uri;
  } catch (error) {
    // Em caso de erro, retorna a URI original
    console.warn('⚠️ Aviso: Não foi possível codificar a URI do MongoDB:', error.message);
    return uri;
  }
}

/**
 * Conecta ao banco de dados principal (MONGO_DB)
 * @returns {Promise<Object>} Objeto do banco de dados
 */
async function connectDB() {
  // Garante escopo global para uso em qualquer bloco
  let mongoUri = env.MONGO_URI || process.env.MONGO_URI;
  let mongoDb = env.MONGO_DB || process.env.MONGO_DB;
  try {
    if (!mongoUri) {
      throw new Error('MONGO_URI não está definida no arquivo .env. Verifique se a variável está configurada.');
    }
    if (!mongoDb) {
      throw new Error('MONGO_DB não está definida no arquivo .env. Verifique se a variável está configurada.');
    }
    assertLocalMongoUri(mongoUri);
    // Atualiza env para usar os valores corretos (para compatibilidade)
    if (!env.MONGO_URI) env.MONGO_URI = mongoUri;
    if (!env.MONGO_DB) env.MONGO_DB = mongoDb;

    // Se já existe uma conexão ativa, verifica se ainda está conectada
    if (client && db) {
      try {
        // Testa a conexão fazendo um ping
        await client.db('admin').command({ ping: 1 });
        return db;
      } catch (error) {
        // Se o ping falhar, a conexão está morta, limpa e reconecta
        console.warn('⚠️ Conexão MongoDB perdida, reconectando...');
        try {
          await client.close();
        } catch (e) {
          // Ignora erros ao fechar
        }
        client = null;
        db = null;
      }
    }

    // Tenta conectar com URI codificada primeiro
    const isDevelopment = env.NODE_ENV === 'development';
    const normalizedUri = ensureMongoUri(mongoUri, mongoDb);
    const encodedURI = encodeMongoURI(normalizedUri, isDevelopment);

    // Cria nova conexão
    client = new MongoClient(encodedURI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      w: 'majority',
    });

    await client.connect();
    db = client.db(mongoDb);

    console.log(`✅ MongoDB Connected: ${client.options.srvHost || 'localhost'}`);
    console.log(`📊 Database: ${mongoDb}`);

    return db;
  } catch (error) {
    // Se o erro for de autenticação, tenta com a URI original (sem codificação)
    if (error.message && (error.message.includes('Authentication failed') || error.message.includes('bad auth'))) {
      console.warn('⚠️ Tentando conexão com URI original (sem codificação)...');
      try {
        // Limpa a conexão anterior
        if (client) {
          try {
            await client.close();
          } catch (e) {}
          client = null;
          db = null;
        }
        // Tenta com a URI original
        const normalizedRetryUri = ensureMongoUri(mongoUri, mongoDb);
        client = new MongoClient(normalizedRetryUri, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 30000,
          maxPoolSize: 10,
          minPoolSize: 2,
          maxIdleTimeMS: 30000,
          retryWrites: true,
          w: 'majority',
        });
        await client.connect();
        db = client.db(mongoDb);
        console.log(`✅ MongoDB Connected (URI original): ${client.options.srvHost || 'localhost'}`);
        console.log(`📊 Database: ${mongoDb}`);
        return db;
      } catch (retryError) {
        console.error('❌ Erro ao conectar ao MongoDB (tentativa com URI original):', retryError.message);
        console.error('💡 Dica: Verifique se o MongoDB local está rodando e sem autenticação.');
        throw retryError;
      }
    }
    console.error('❌ Erro ao conectar ao MongoDB:', error.message);
    throw error;
  }
}

/**
 * Conecta ao banco de dados novo (MONGO_DB_NOVO)
 * @returns {Promise<Object>} Objeto do banco de dados novo
 */
async function connectNewDB() {
  try {
    if (!env.MONGO_URI) {
      throw new Error('MONGO_URI não está definida no arquivo .env');
    }

    if (!env.MONGO_DB_NOVO) {
      throw new Error('MONGO_DB_NOVO não está definida no arquivo .env');
    }
    assertLocalMongoUri(env.MONGO_URI);

    // Se já existe uma conexão ativa para o banco novo, retorna
    if (client && newDb) {
      return newDb;
    }

    // Se já existe um client conectado, reutiliza; senão cria novo
    if (!client) {
      const isDevelopment = env.NODE_ENV === 'development';
      const normalizedUri = ensureMongoUri(env.MONGO_URI, env.MONGO_DB_NOVO);
      const encodedURI = encodeMongoURI(normalizedUri, isDevelopment);

      client = new MongoClient(encodedURI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        retryWrites: true,
        w: 'majority',
      });
      await client.connect();
    }

    // Sempre cria/atualiza a referência ao banco novo
    newDb = client.db(env.MONGO_DB_NOVO);

    console.log(`✅ MongoDB Connected (Novo): ${client.options.srvHost || 'localhost'}`);
    console.log(`📊 Database: ${env.MONGO_DB_NOVO}`);

    return newDb;
  } catch (error) {
    // Se o erro for de autenticação, tenta com a URI original
    if (error.message && (error.message.includes('Authentication failed') || error.message.includes('bad auth'))) {
      console.warn('⚠️ Tentando conexão com URI original (sem codificação)...');
      
      try {
        if (client) {
          try {
            await client.close();
          } catch (e) {
            // Ignora erros ao fechar
          }
          client = null;
          newDb = null;
        }

        const normalizedRetryUri = ensureMongoUri(env.MONGO_URI, env.MONGO_DB_NOVO);
        client = new MongoClient(normalizedRetryUri, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
          connectTimeoutMS: 30000,
          maxPoolSize: 10,
          minPoolSize: 2,
          maxIdleTimeMS: 30000,
          retryWrites: true,
          w: 'majority',
        });

        await client.connect();
        newDb = client.db(env.MONGO_DB_NOVO);

        console.log(`✅ MongoDB Connected (Novo, URI original): ${client.options.srvHost || 'localhost'}`);
        console.log(`📊 Database: ${env.MONGO_DB_NOVO}`);

        return newDb;
      } catch (retryError) {
        console.error('❌ Erro ao conectar ao MongoDB Novo:', retryError.message);
        throw retryError;
      }
    }

    console.error('❌ Erro ao conectar ao MongoDB Novo:', error.message);
    throw error;
  }
}

/**
 * Fecha a conexão com o MongoDB
 */
async function closeConnection() {
  try {
    if (client) {
      await client.close();
      client = null;
      db = null;
      newDb = null;
      console.log('✅ Conexão MongoDB fechada');
    }
  } catch (error) {
    console.error('❌ Erro ao fechar conexão MongoDB:', error.message);
    throw error;
  }
}

module.exports = {
  connectDB,
  connectNewDB,
  closeConnection
};

