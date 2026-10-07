/**
 * Validador de Variáveis de Ambiente
 * Valida variáveis obrigatórias antes de inicializar serviços
 */

require('dotenv').config();
const logger = require('../utils/logger');
// #1154: o gate de assinatura abaixo pergunta ao PROVIDER em vez de ler
// process.env. Desde #1157 o registro de chaves públicas pode vir de arquivo,
// então um boot check que lesse variáveis diretamente validaria uma
// configuração diferente da que a aplicação de fato usa -- que é exatamente o
// tipo de divergência silenciosa que este arquivo existe para eliminar.
const auditSigningProvider = require('../services/audit-signing.provider');

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

/**
 * #1086: sanidade do slot de chave ANTERIOR que #1086 restaurou em
 * keyRegistry.js.
 *
 * Estas condições são SEMPRE aviso, nunca fatal, inclusive em produção --
 * deliberadamente uma severidade diferente das de validateEncryptionEnv. Um
 * slot mal configurado é um problema de DISPONIBILIDADE (envelopes antigos
 * decifram para null), não de confidencialidade: nada passa a ser gravado em
 * texto claro por causa dele. Derrubar um boot de produção por isso puniria
 * o operador que está no meio de uma rotação, que é exatamente quem este
 * slot existe para ajudar.
 *
 * O silêncio é o defeito real aqui: keyRegistry descarta um slot inválido
 * sem dizer nada, então sem este aviso o operador só descobre no primeiro
 * decryptValue null -- que #1086 mostra ser silencioso por construção.
 */
function validateKeyRotationEnv() {
  const warnings = [];

  const previousKey = String(process.env.ENCRYPTION_KEY_PREVIOUS || '').trim();
  const previousKeyId = String(process.env.ENCRYPTION_KEY_PREVIOUS_ID || '').trim();
  const activeKeyId = String(process.env.ENCRYPTION_KEY_ID || 'default').trim();

  if (previousKey && !previousKeyId) {
    warnings.push(
      '[SECURITY] ENCRYPTION_KEY_PREVIOUS está definida sem ENCRYPTION_KEY_PREVIOUS_ID: '
        + 'o slot anterior é descartado e todo envelope gravado sob a chave anterior '
        + 'decifra para null (#1086)'
    );
  }

  if (!previousKey && previousKeyId) {
    warnings.push(
      '[SECURITY] ENCRYPTION_KEY_PREVIOUS_ID está definido sem ENCRYPTION_KEY_PREVIOUS: '
        + 'não há chave anterior registrada, apenas um id órfão (#1086)'
    );
  }

  if (previousKey && previousKeyId && previousKeyId === activeKeyId) {
    warnings.push(
      `[SECURITY] ENCRYPTION_KEY_PREVIOUS_ID é igual a ENCRYPTION_KEY_ID ("${activeKeyId}"): `
        + 'o slot anterior é descartado, porque getKeyById resolve sempre a entrada ativa. '
        + 'Dê um id próprio à chave anterior antes de rotacionar (#1086)'
    );
  }

  return warnings;
}

/**
 * #1154: sanidade da configuração de assinatura de auditoria no boot.
 *
 * SEMPRE aviso, nunca fatal, inclusive em produção -- a mesma severidade
 * deliberada de validateKeyRotationEnv acima, e por um motivo estrutural, não
 * por comodidade: #989 estabelece que o job noturno NÃO pode passar a
 * rejeitar, e #979 é a decisão em aberto do eixo fatal-vs-degradar. A direção
 * 1 de #1154 é precisamente a que não depende dessa decisão. Se #979 concluir
 * "fatal em produção", é esta função que ganha a escalada, no formato que
 * validateEncryptionEnv já usa.
 *
 * NÃO é uma quarta convenção de boot check (#979 adverte contra isso): é o
 * mesmo par validar/avisar que #1085 introduziu, chamado do mesmo lugar.
 *
 * O silêncio é o defeito real. audit-v2.service chama loadPrivateKey/getKeyId
 * dentro de try/FINALLY -- não try/catch -- então o throw sobe até o catch de
 * runOnce, que loga e engole; e o gatilho é um setTimeout para 02:30 UTC.
 * Sem este aviso o primeiro e único sinal chega até 24h depois do boot, no log
 * de um worker cujo healthcheck depende só do Redis e segue reportando
 * healthy indefinidamente.
 *
 * A verificação é um ida-e-volta completo (assina e confere), porque a falha
 * que mais parece saudável é a pior: uma chave privada legível cujo id não
 * tem par no registro assina normalmente e faz processTimestampBacklog
 * carimbar FAILED/signature_unknown_key_id em toda raiz.
 */
const AUDIT_SIGNING_BOOT_PROBE = Buffer.from('bioavanced-audit-signing-boot-probe');

async function validateAuditSigningEnv() {
  const warnings = [];

  let keyId = '';
  try {
    keyId = auditSigningProvider.getKeyId();
  } catch (error) {
    warnings.push(
      '[AUDIT] AUDIT_MERKLE_SIGN_KEY_ID não está configurado: nenhuma raiz de '
        + 'auditoria pode ser assinada e o selo diário falha em silêncio às 02:30 UTC (#1154)'
    );
  }

  try {
    await auditSigningProvider.loadPrivateKey();
  } catch (error) {
    warnings.push(
      '[AUDIT] a chave privada de assinatura não pôde ser lida ('
        + (error.code || error.message)
        + '): nenhuma raiz de auditoria pode ser assinada e o selo diário falha em '
        + 'silêncio às 02:30 UTC (#1154)'
    );
  }

  if (warnings.length > 0) return warnings;

  try {
    const signed = await auditSigningProvider.sign(AUDIT_SIGNING_BOOT_PROBE);
    const verification = auditSigningProvider.verify(AUDIT_SIGNING_BOOT_PROBE, signed.signature, keyId);
    if (!verification.ok) {
      warnings.push(
        '[AUDIT] a chave de assinatura "' + keyId + '" assina mas não verifica ('
          + verification.reason
          + '): o stack sela raízes corretamente e declara os próprios artefatos '
          + 'inválidos. Confira AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE / _JSON contra a '
          + 'chave ativa (#1154, #1157)'
      );
    }
  } catch (error) {
    warnings.push(
      '[AUDIT] o teste de assinatura no boot falhou (' + error.message + '): '
        + 'a configuração de assinatura de auditoria não está utilizável (#1154)'
    );
  }

  return warnings;
}

/**
 * #1154: ponto de entrada de boot, chamado por server.js e worker.js ao lado
 * de validateEncryptionAndHalt. Deliberadamente "AndWarn" e não "AndHalt":
 * não lança em nenhum ambiente. Devolve true quando nada foi encontrado.
 */
async function validateAuditSigningAndWarn() {
  const warnings = await validateAuditSigningEnv();
  warnings.forEach((warning) => logger.warn(warning));
  return warnings.length === 0;
}

function validateEncryptionEnv() {
  const insecureStorage = [];
  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();

  if (!String(process.env.ENCRYPTION_KEY || '').trim()) {
    insecureStorage.push(
      '[SECURITY] ENCRYPTION_KEY não está definida: nenhum campo sensível pode ser cifrado '
        + 'em repouso (RNF020 AC#3, RNF007) e todo envelope já gravado fica indecifrável'
    );
  }

  for (const [name, consequence] of UNENCRYPTED_STORAGE_OPT_OUTS) {
    if (process.env[name] === 'true') {
      insecureStorage.push(`[SECURITY] ${name}=true: ${consequence}`);
    }
  }

  return nodeEnv === 'production'
    ? { errors: insecureStorage, warnings: validateKeyRotationEnv() }
    : { errors: [], warnings: [...insecureStorage, ...validateKeyRotationEnv()] };
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
  validateAuditSigningEnv,
  validateAuditSigningAndWarn,
  validateEncryptionEnv,
  validateKeyRotationEnv,
  validateEncryptionAndHalt,
  validateAllEnv,
  validateAndHalt,
  validateRedisOnly,
};