/**
 * Validador de Variáveis de Ambiente
 * Valida variáveis obrigatórias antes de inicializar serviços
 */

require('dotenv').config();
const logger = require('../utils/logger');

/**
 * Valida variáveis Redis obrigatórias
 */
function validateRedisEnv() {
  const errors = [];
  const warnings = [];
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const isLocalEnv = nodeEnv === 'development' || nodeEnv === 'test';

  const redisUrl = String(process.env.REDIS_URL || '').trim();
  let hostFromUrl = '';
  if (redisUrl) {
    try {
      hostFromUrl = new URL(redisUrl).hostname.toLowerCase();
    } catch (_) {
      errors.push('REDIS_URL inválida');
    }
  }

  const host = String(hostFromUrl || process.env.REDIS_HOST || '').toLowerCase();
  const isLocalHost = ['127.0.0.1', 'localhost', '::1'].includes(host);

  if (!redisUrl && !process.env.REDIS_HOST) {
    errors.push('REDIS_HOST não está definido no .env');
  }

  if (!redisUrl && !process.env.REDIS_PORT) {
    errors.push('REDIS_PORT não está definido no .env');
  } else if (!redisUrl) {
    const port = Number(process.env.REDIS_PORT);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      errors.push('REDIS_PORT deve ser um número válido entre 1 e 65535');
    }
  }

  if (!process.env.REDIS_PASSWORD && !isLocalEnv && !isLocalHost) {
    errors.push('REDIS_PASSWORD não está definido no .env');
  } else if (!process.env.REDIS_PASSWORD && isLocalEnv && !isLocalHost) {
    // NODE_ENV=development/test não garante que o host seja de fato local (ex.: Redis
    // remoto de staging, ou um hostname de rede Docker). Não bloqueia o startup — isso
    // quebraria docker-compose.test.yml, que aponta REDIS_HOST=redis sem senha — mas
    // avisa, já que NODE_ENV sozinho não deveria decidir silenciosamente essa exceção.
    warnings.push(`REDIS_PASSWORD não está definido e o host Redis ("${host}") não é local; isso só passa porque NODE_ENV=${nodeEnv}`);
  }

  if (!redisUrl && !isLocalEnv) {
    warnings.push('REDIS_URL não está definido; usando host/porta separados');
  }

  return { errors, warnings };
}

/**
 * Valida todas as variáveis de ambiente essenciais
 */
function validateAllEnv() {
  const errors = [];
  const warnings = [];

  const redisValidation = validateRedisEnv();
  errors.push(...redisValidation.errors);
  warnings.push(...redisValidation.warnings);

  if (!process.env.MONGO_URI) {
    warnings.push('MONGO_URI não está definido (algumas funcionalidades podem não funcionar)');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Valida e interrompe se necessário
 * @param {boolean} allowDevelopment - Permite continuar em desenvolvimento mesmo com erros
 */
function validateAndHalt(allowDevelopment = true) {
  const validation = validateAllEnv();

  if (validation.errors.length > 0) {
    logger.error('[ERROR] Variáveis de ambiente obrigatórias não configuradas:');
    validation.errors.forEach((error) => {
      logger.error(`  - ${error}`);
    });

    if (allowDevelopment && process.env.NODE_ENV === 'development') {
      logger.warn('[WARN] Modo desenvolvimento: continuando apesar dos erros');
      logger.warn('[WARN] Configure as variáveis no arquivo .env para evitar problemas');
      return false;
    }

    logger.error('[ERROR] Interrompendo inicialização devido a variáveis faltantes');
    throw new Error(`Variáveis de ambiente obrigatórias não configuradas: ${validation.errors.join(', ')}`);
  }

  if (validation.warnings.length > 0) {
    logger.warn('[WARN] Avisos de configuração:');
    validation.warnings.forEach((warning) => {
      logger.warn(`  - ${warning}`);
    });
  }

  return true;
}

/**
 * Valida apenas Redis (para uso específico)
 * @param {boolean} allowDevelopment - Permite continuar em desenvolvimento
 * @param {boolean} silent - Se true, não loga (para evitar duplicação)
 */
function validateRedisOnly(allowDevelopment = true, silent = false) {
  const validation = validateRedisEnv();

  if (validation.errors.length > 0) {
    if (!silent) {
      logger.error('[ERROR] Configuração Redis incorreta:');
      validation.errors.forEach((error) => {
        logger.error(`  - ${error}`);
      });
    }

    if (allowDevelopment && process.env.NODE_ENV === 'development') {
      if (!silent) {
        logger.warn('[WARN] Modo desenvolvimento: Redis não será inicializado');
      }
      return false;
    }

    throw new Error(`Redis configurado incorretamente: ${validation.errors.join(', ')}`);
  }

  if (validation.warnings.length > 0 && !silent) {
    logger.warn('[WARN] Avisos de configuração Redis:');
    validation.warnings.forEach((warning) => {
      logger.warn(`  - ${warning}`);
    });
  }

  return true;
}

module.exports = {
  validateRedisEnv,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
};