/**
 * src/utils/security.js
 * Utilitário de Segurança - Sanitização e Validação
 * Conformidade: LGPD + ANVISA + OWASP Top 10
 */

const logger = require('./logger');

// Expressões regulares para validação
const WHITELIST_PATTERN = /^[a-zA-Z0-9\s\-._@áéíóúãõçÁÉÍÓÚÃÕÇ]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HTML_TAGS_PATTERN = /<[^>]*>/g;
const SCRIPT_PATTERN = /<script[\s\S]*?<\/script>/gi;
const EVENT_HANDLER_PATTERN = /on\w+\s*=/gi;

/**
 * Sanitiza entrada de texto removendo tags HTML e scripts
 * Previne XSS (Cross-Site Scripting)
 * 
 * @param {string} text - Texto a sanitizar
 * @returns {string} Texto sanitizado
 */
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  try {
    let sanitized = text.trim();

    // Remove scripts
    sanitized = sanitized.replace(SCRIPT_PATTERN, '');

    // Remove event handlers (onclick, onerror, etc)
    sanitized = sanitized.replace(EVENT_HANDLER_PATTERN, '');

    // Remove todas as tags HTML
    sanitized = sanitized.replace(HTML_TAGS_PATTERN, '');

    // Remove caracteres de controle Unicode perigosos
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Limita tamanho máximo (previne DoS)
    const MAX_LENGTH = 1000;
    if (sanitized.length > MAX_LENGTH) {
      logger.warn(`Input truncado de ${sanitized.length} para ${MAX_LENGTH} caracteres`);
      sanitized = sanitized.substring(0, MAX_LENGTH);
    }

    return sanitized;
  } catch (error) {
    logger.error('Erro ao sanitizar input:', error.message);
    return '';
  }
}

/**
 * Valida CPF usando algoritmo de dígito verificador
 * Conformidade: LGPD (melhorar rastreabilidade de pacientes)
 * 
 * @param {string} cpf - CPF a validar (apenas números)
 * @returns {boolean} True se CPF é válido
 */
function validateCPF(cpf) {
  if (!cpf || typeof cpf !== 'string') {
    return false;
  }

  try {
    // Remove formatação (pontos e hífens)
    const cleanCPF = cpf.replace(/[\.\-\s]/g, '');

    // Valida se tem 11 dígitos
    if (!/^\d{11}$/.test(cleanCPF)) {
      logger.debug(`CPF inválido: formato incorreto (${cleanCPF})`);
      return false;
    }

    // Rejeita CPFs com todos os dígitos iguais (CPFs conhecidos como inválidos)
    const invalidPatterns = [
      '00000000000',
      '11111111111',
      '22222222222',
      '33333333333',
      '44444444444',
      '55555555555',
      '66666666666',
      '77777777777',
      '88888888888',
      '99999999999'
    ];

    if (invalidPatterns.includes(cleanCPF)) {
      logger.debug(`CPF sequencial detectado: ${cleanCPF}`);
      return false;
    }

    // Calcula primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cleanCPF.charAt(i)) * (10 - i);
    }

    let remainder = sum % 11;
    const firstDigit = remainder < 2 ? 0 : 11 - remainder;

    if (parseInt(cleanCPF.charAt(9)) !== firstDigit) {
      logger.debug(`CPF inválido: primeiro dígito verificador incorreto`);
      return false;
    }

    // Calcula segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cleanCPF.charAt(i)) * (11 - i);
    }

    remainder = sum % 11;
    const secondDigit = remainder < 2 ? 0 : 11 - remainder;

    if (parseInt(cleanCPF.charAt(10)) !== secondDigit) {
      logger.debug(`CPF inválido: segundo dígito verificador incorreto`);
      return false;
    }

    logger.debug(`CPF validado com sucesso`);
    return true;
  } catch (error) {
    logger.error('Erro ao validar CPF:', error.message);
    return false;
  }
}

/**
 * Valida email com padrão seguro
 * 
 * @param {string} email - Email a validar
 * @returns {boolean} True se email é válido
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const sanitized = sanitizeInput(email);
  return EMAIL_PATTERN.test(sanitized) && sanitized.length <= 255;
}

/**
 * Redação de dados sensíveis para logs/auditoria
 * Previne exposição acidental de PII
 * 
 * @param {object} obj - Objeto contendo dados sensíveis
 * @param {array} fieldsToRedact - Lista de campos a redacionar
 * @returns {object} Objeto com campos redacionados
 */
function sanitizeSensitiveData(obj, fieldsToRedact = []) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  try {
    const redactedObj = { ...obj };
    const defaultRedactFields = ['cpf', 'password', 'token', 'secret', 'ssn', 'pii'];

    const fieldsToProcess = [...defaultRedactFields, ...fieldsToRedact];

    fieldsToProcess.forEach(field => {
      if (redactedObj[field]) {
        redactedObj[field] = '***REDATADO***';
      }
    });

    return redactedObj;
  } catch (error) {
    logger.error('Erro ao redacionar dados sensíveis:', error.message);
    return obj;
  }
}

/**
 * Escapa strings para prevenir MongoDB injection attacks
 * 
 * @param {string} str - String a escapar
 * @returns {string} String escapada
 */
function escapeString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }

  try {
    // Remove caracteres especiais do MongoDB
    return str
      .replace(/\$/g, '\\$')
      .replace(/\./g, '\\.')
      .trim();
  } catch (error) {
    logger.error('Erro ao escapar string:', error.message);
    return '';
  }
}

/**
 * Valida entrada de dados estruturado (paciente, amostra, etc)
 * Implementa whitelist approach
 * 
 * @param {object} data - Dados a validar
 * @param {array} allowedFields - Campos permitidos
 * @returns {object} { isValid: boolean, errors: array, cleanData: object }
 */
function validateStructuredInput(data, allowedFields = []) {
  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: ['Dados não fornecidos ou inválidos'],
      cleanData: {}
    };
  }

  const errors = [];
  const cleanData = {};

  try {
    allowedFields.forEach(field => {
      if (field in data) {
        const value = data[field];

        if (typeof value === 'string') {
          cleanData[field] = sanitizeInput(value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          cleanData[field] = value;
        } else if (Array.isArray(value)) {
          cleanData[field] = value.map(v => 
            typeof v === 'string' ? sanitizeInput(v) : v
          );
        } else if (typeof value === 'object' && value !== null) {
          cleanData[field] = value; // Para ObjectIds, dates, etc
        }
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      cleanData
    };
  } catch (error) {
    logger.error('Erro ao validar entrada estruturada:', error.message);
    return {
      isValid: false,
      errors: ['Erro ao processar validação'],
      cleanData: {}
    };
  }
}

module.exports = {
  sanitizeInput,
  validateCPF,
  validateEmail,
  sanitizeSensitiveData,
  escapeString,
  validateStructuredInput
};
