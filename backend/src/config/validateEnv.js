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

  // Variáveis obrigatórias
  if (!process.env.REDIS_HOST) {
    errors.push('REDIS_HOST não está definido no .env');
  }

  if (!process.env.REDIS_PORT) {
    errors.push('REDIS_PORT não está definido no .env');
  } else {
    const port = Number(process.env.REDIS_PORT);
    if (isNaN(port) || port <= 0 || port > 65535) {
      errors.push('REDIS_PORT deve ser um número válido entre 1 e 65535');
    }
  }

  if (!process.env.REDIS_PASSWORD) {
    errors.push('REDIS_PASSWORD não está definido no .env');
  }

  // Variáveis opcionais mas recomendadas
  if (!process.env.REDIS_TLS || (process.env.REDIS_TLS !== 'true' && process.env.REDIS_TLS !== '1')) {
    warnings.push('REDIS_TLS não está definido como "true" (geralmente necessário para Redis Cloud)');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Valida todas as variáveis de ambiente essenciais
 */
function validateAllEnv() {
  const errors = [];
  const warnings = [];

  // Redis
  const redisValidation = validateRedisEnv();
  errors.push(...redisValidation.errors);
  warnings.push(...redisValidation.warnings);

  // MongoDB (opcional - não bloqueia se não estiver)
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

  // Log de erros
  if (validation.errors.length > 0) {
    logger.error('[ERROR] Variáveis de ambiente obrigatórias não configuradas:');
    validation.errors.forEach(error => {
      logger.error(`  - ${error}`);
    });

    // Em desenvolvimento, apenas avisa
    if (allowDevelopment && process.env.NODE_ENV === 'development') {
      logger.warn('[WARN] Modo desenvolvimento: continuando apesar dos erros');
      logger.warn('[WARN] Configure as variáveis no arquivo .env para evitar problemas');
      return false; // Não interrompe, mas retorna false
    } else {
      // Em produção, interrompe
      logger.error('[ERROR] Interrompendo inicialização devido a variáveis faltantes');
      throw new Error(`Variáveis de ambiente obrigatórias não configuradas: ${validation.errors.join(', ')}`);
    }
  }

  // Log de avisos
  if (validation.warnings.length > 0) {
    logger.warn('[WARN] Avisos de configuração:');
    validation.warnings.forEach(warning => {
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
      validation.errors.forEach(error => {
        logger.error(`  - ${error}`);
      });
    }

    if (allowDevelopment && process.env.NODE_ENV === 'development') {
      if (!silent) {
        logger.warn('[WARN] Modo desenvolvimento: Redis não será inicializado');
      }
      return false;
    } else {
      throw new Error(`Redis configurado incorretamente: ${validation.errors.join(', ')}`);
    }
  }

  if (validation.warnings.length > 0 && !silent) {
    logger.warn('[WARN] Avisos de configuração Redis:');
    validation.warnings.forEach(warning => {
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

