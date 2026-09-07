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
 * #1085: postura de criptografia em repouso.
 *
 * Direção 3 (decisão de Dennis, 2026-09-07): avisar em TODO ambiente, e
 * tratar as mesmas condições como erro fatal de configuração quando
 * NODE_ENV === 'production'. É a mesma forma que este arquivo já usa --
 * aviso para MONGO_URI, validação para Redis -- e deixa qualquer stack de
 * desenvolvimento subindo exatamente como sobe hoje.
 *
 * Sem ENCRYPTION_KEY nenhum campo sensível é cifrado em repouso: encryptValue
 * devolve null e, antes de #1083, todo chamador lia esse null como "pule este
 * campo", persistindo texto claro e respondendo 201. Os dois opt-outs abaixo
 * são o consentimento explícito para esse comportamento, e até aqui nada os
 * anunciava: um stack podia ser configurado para guardar tudo em claro e
 * ficar em silêncio.
 *
 * Os opt-outs são comparados com a string exata 'true', e não por
 * truthiness, exatamente como fileCrypto.js (#938) e fieldEncryption.js
 * (#1083) já fazem -- um '1'/'yes' perdido num arquivo .env não pode valer
 * como consentimento para armazenamento em texto claro.
 */
const UNENCRYPTED_STORAGE_OPT_OUTS = [
  [
    'ALLOW_UNENCRYPTED_FILE_STORAGE',
    'blobs de arquivo serão gravados sem criptografia (RNF029 AC#5, #938)'
  ],
  [
    'ALLOW_UNENCRYPTED_FIELD_STORAGE',
    'campos sensíveis serão gravados em texto claro em repouso (RNF020 AC#3, #1083)'
  ]
];

function validateEncryptionEnv() {
  const messages = [];
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();

  if (!String(process.env.ENCRYPTION_KEY || '').trim()) {
    messages.push(
      '[SECURITY] ENCRYPTION_KEY não está definida: nenhum campo sensível pode ser cifrado '
        + 'em repouso (RNF020 AC#3, RNF007) e todo envelope já gravado fica indecifrável'
    );
  }

  for (const [name, consequence] of UNENCRYPTED_STORAGE_OPT_OUTS) {
    if (process.env[name] === 'true') {
      messages.push(`[SECURITY] ${name}=true: ${consequence}`);
    }
  }

  return nodeEnv === 'production'
    ? { errors: messages, warnings: [] }
    : { errors: [], warnings: messages };
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

  const encryptionValidation = validateEncryptionEnv();
  errors.push(...encryptionValidation.errors);
  warnings.push(...encryptionValidation.warnings);

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

/**
 * #1085: ponto de entrada de boot para a postura de criptografia.
 *
 * Deliberadamente separado de validateAndHalt, e NÃO um chamador dele. Se o
 * boot passasse a chamar validateAndHalt, uma configuração Redis inválida
 * passaria a ser fatal para o backend em produção -- e isso inverteria a
 * postura que #977 documenta explicitamente em server.js ("uma falha de Redis
 * NÃO é fatal para o backend; só o enfileiramento de importação degrada").
 * Este gate decide sobre criptografia e sobre mais nada.
 *
 * Aviso alto em qualquer ambiente; erro fatal em produção. Lança em vez de
 * chamar process.exit para que o catch de startup de cada entrypoint faça a
 * terminação do jeito que aquele arquivo já faz.
 */
function validateEncryptionAndHalt() {
  const { errors, warnings } = validateEncryptionEnv();

  warnings.forEach((warning) => logger.warn(warning));
  errors.forEach((error) => logger.error(error));

  if (errors.length > 0) {
    throw new Error(
      `Configuração de criptografia inaceitável em produção (#1085): ${errors.join(' | ')}`
    );
  }

  return true;
}

module.exports = {
  validateRedisEnv,
  validateEncryptionEnv,
  validateEncryptionAndHalt,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
};