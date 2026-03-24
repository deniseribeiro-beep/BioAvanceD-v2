/**
 * Configuração de Conexão Redis
 * Cliente Redis usando ioredis para BullMQ
 */

const fs = require('fs');
const path = require('path');

const envName = String(process.env.NODE_ENV || 'development').toLowerCase();
const testEnvPath = path.join(__dirname, '..', '..', '.env.test');
const defaultEnvPath = path.join(__dirname, '..', '..', '.env');
const envFilePath = envName === 'test' && fs.existsSync(testEnvPath) ? testEnvPath : defaultEnvPath;

require('dotenv').config({ path: envFilePath });
const Redis = require('ioredis');
const logger = require('../utils/logger');
const {
  REDIS_URL,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_USERNAME,
  REDIS_TLS,
} = require('./env');

/**
 * Cria instância Redis
 * Usa configuração do env.js
 */
function createRedisConnection() {
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const isLocalEnv = nodeEnv === 'development' || nodeEnv === 'test';
  const redisTlsRaw = String(process.env.REDIS_TLS ?? REDIS_TLS ?? '').toLowerCase();
  const redisTlsEnabled = redisTlsRaw === 'true' || redisTlsRaw === '1';

  const redisUrl = String(REDIS_URL || process.env.REDIS_URL || '').trim();
  const normalizedHost = String(REDIS_HOST || '').trim().toLowerCase();

  const parsedRedisUrl = (() => {
    if (!redisUrl) return null;
    try {
      return new URL(redisUrl);
    } catch (_) {
      return null;
    }
  })();

  const hostFromUrl = parsedRedisUrl?.hostname ? parsedRedisUrl.hostname.toLowerCase() : '';
  const effectiveHost = hostFromUrl || normalizedHost;
  const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(effectiveHost);
  const shouldUseTls = redisTlsEnabled && !isLocalEnv;
  const shouldGracefullyDisableLocalRedis = isLocalEnv && isLocalHost;

  // Validação básica
  if (!redisUrl && !REDIS_HOST) {
    throw new Error('REDIS_HOST ou REDIS_URL não está definido no .env');
  }

  if (!redisUrl && !REDIS_PORT) {
    throw new Error('REDIS_PORT não está definido no .env');
  }

  if (!REDIS_PASSWORD && !isLocalEnv && !isLocalHost) {
    throw new Error('REDIS_PASSWORD não está definido no .env');
  }

  // Log de configuração
  logger.info('[INFO] 🔍 Config Redis:');
  logger.info(`   url: ${redisUrl || 'undefined'}`);
  logger.info(`   host: ${effectiveHost || 'undefined'}`);
  logger.info(`   port: ${parsedRedisUrl?.port || REDIS_PORT || 'undefined'}`);
  logger.info(`   username: ${REDIS_USERNAME || 'undefined'}`);
  logger.info(`   tls: ${shouldUseTls}`);
  logger.info(`   hasPassword: ${!!REDIS_PASSWORD}`);
  
  // Valida variáveis undefined
  if (!redisUrl && !REDIS_HOST) {
    logger.error('[ERROR] Variável REDIS_HOST/REDIS_URL não definida no .env');
  }
  if (!redisUrl && !REDIS_PORT) {
    logger.error('[ERROR] Variável REDIS_PORT não definida no .env');
  }
  if (!REDIS_PASSWORD && !isLocalEnv && !isLocalHost) {
    logger.error('[ERROR] Variável REDIS_PASSWORD não definida no .env');
  }

  // Aviso sobre TLS para Redis Cloud
  if (!shouldUseTls && effectiveHost && effectiveHost.includes('cloud.redislabs.com')) {
    logger.warn('[WARN] ⚠️ REDIS_TLS está como false, mas você está usando Redis Cloud!');
    logger.warn('[WARN] ⚠️ Redis Cloud requer TLS. Configure REDIS_TLS=true no .env');
  }

  // Configuração Redis
  const config = {
    maxRetriesPerRequest: null, // Requerido pelo BullMQ
    enableReadyCheck: false, // Requerido pelo BullMQ
    connectTimeout: 10000,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        logger.warn('[WARN] Redis em modo READONLY, reconectando...');
        return true;
      }
      return false;
    }
  };

  if (!redisUrl) {
    config.host = REDIS_HOST;
    config.port = Number(REDIS_PORT);
    config.username = REDIS_USERNAME || 'default';
    if (REDIS_PASSWORD) {
      config.password = REDIS_PASSWORD;
    }
  } else {
    config.username = REDIS_USERNAME || parsedRedisUrl?.username || 'default';
    if (REDIS_PASSWORD || parsedRedisUrl?.password) {
      config.password = REDIS_PASSWORD || parsedRedisUrl.password;
    }
  }

  if (shouldUseTls) {
    config.tls = {};
  }

  // Cria conexão Redis
  const redis = redisUrl ? new Redis(redisUrl, config) : new Redis(config);

  // Event listeners
  redis.on('connect', () => {
    logger.info('[INFO] Redis conectado');
  });

  redis.on('ready', () => {
    logger.info('[INFO] Redis pronto para uso');
  });

  redis.on('error', (err) => {
    if (shouldGracefullyDisableLocalRedis && err?.code === 'ECONNREFUSED') {
      logger.warn('[WARN] Redis local indisponível; fila desabilitada neste ambiente');
      try {
        redis.disconnect();
      } catch (_) {}
      return;
    }

    logger.error('[ERROR] Erro na conexão Redis:', err.message);
  });

  redis.on('close', () => {
    logger.warn('[WARN] Conexão Redis fechada');
  });

  redis.on('reconnecting', (delay) => {
    logger.warn(`[WARN] Reconectando ao Redis em ${delay}ms...`);
  });

  return redis;
}

// Instância singleton
let redisInstance = null;

/**
 * Obtém instância Redis (singleton)
 */
function getRedisInstance() {
  if (!redisInstance) {
    redisInstance = createRedisConnection();
  }
  return redisInstance;
}

/**
 * Testa conexão Redis
 */
async function testRedisConnection() {
  try {
    const redis = getRedisInstance();
    
    // Aguarda conexão estar pronta (máximo 15 segundos)
    if (redis.status !== 'ready') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Tempo limite ao aguardar conexão Redis estar pronta (15s)'));
        }, 15000);

        const cleanup = () => {
          clearTimeout(timeout);
          redis.removeListener('ready', readyHandler);
          redis.removeListener('error', errorHandler);
        };

        const readyHandler = () => {
          cleanup();
          resolve();
        };

        const errorHandler = (err) => {
          cleanup();
          reject(err);
        };

        if (redis.status === 'ready') {
          cleanup();
          resolve();
        } else {
          redis.once('ready', readyHandler);
          redis.once('error', errorHandler);
        }
      });
    }

    // Testa com PING
    const result = await redis.ping();
    if (result === 'PONG') {
      logger.info('[INFO] Teste de conexão Redis: SUCESSO');
      return true;
    } else {
      logger.error('[ERROR] Teste de conexão Redis: FALHOU (resposta inesperada)');
      return false;
    }
  } catch (error) {
    const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
    const isLocalEnv = nodeEnv === 'development' || nodeEnv === 'test';
    const redisUrl = String(REDIS_URL || process.env.REDIS_URL || '').trim();
    const normalizedHost = String(REDIS_HOST || '').trim().toLowerCase();
    const parsedRedisUrl = (() => {
      if (!redisUrl) return null;
      try {
        return new URL(redisUrl);
      } catch (_) {
        return null;
      }
    })();
    const hostFromUrl = parsedRedisUrl?.hostname ? parsedRedisUrl.hostname.toLowerCase() : '';
    const effectiveHost = hostFromUrl || normalizedHost;
    const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(effectiveHost);

    if (isLocalEnv && isLocalHost && error.code === 'ECONNREFUSED') {
      logger.warn('[WARN] Redis não está disponível no ambiente local; seguindo sem fila');
      return false;
    }

    logger.error('[ERROR] Teste de conexão Redis falhou:', error.message);
    if (error.code) {
      logger.error(`[ERROR] Código do erro: ${error.code}`);
    }
    if (error.syscall) {
      logger.error(`[ERROR] Chamada de sistema: ${error.syscall}`);
    }
    if (error.address) {
      logger.error(`[ERROR] Endereço: ${error.address}:${error.port || ''}`);
    }
    
    // Dicas de solução
    if (error.message.includes('ECONNREFUSED')) {
      logger.error('[ERROR] 💡 Dica: Verifique se o Redis está rodando e acessível');
      logger.error('[ERROR] 💡 Dica: Para Redis Cloud, verifique se REDIS_TLS=true está configurado');
    }
    if (error.message.includes('ETIMEDOUT') || error.message.includes('Timeout')) {
      logger.error('[ERROR] 💡 Dica: Verifique se o host e porta estão corretos');
      logger.error('[ERROR] 💡 Dica: Verifique se há firewall bloqueando a conexão');
    }
    
    return false;
  }
}

/**
 * Fecha conexão Redis
 */
async function closeRedisConnection() {
  if (redisInstance) {
    try {
      await redisInstance.quit();
      redisInstance = null;
      logger.info('[INFO] Conexão Redis fechada');
    } catch (error) {
      logger.error('[ERROR] Erro ao fechar conexão Redis:', error.message);
      throw error;
    }
  }
}

// Exporta proxy lazy (compatível com uso atual sem conectar no import)
const proxyTarget = {};

const redis = new Proxy(proxyTarget, {
    get(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop];
      }
      const instance = getRedisInstance();
      const value = instance[prop];
      return typeof value === 'function' ? value.bind(instance) : value;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
    has(target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return true;
      }
      return redisInstance ? prop in redisInstance : false;
    },
  });

module.exports = redis;
module.exports.getRedisInstance = getRedisInstance;
module.exports.testRedisConnection = testRedisConnection;
module.exports.closeRedisConnection = closeRedisConnection;
