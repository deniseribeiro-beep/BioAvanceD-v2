/**
 * Validador de qualidade MIABIS
 * Escala oficial adotada pelos biobancos internacionais:
 * GOOD - Adequada / Boa Qualidade
 * COMPROMISED - Comprometida (Hemólise/Lipemia)
 * UNKNOWN - Desconhecida / Não Avaliada
 */
const { MIABIS_QUALITY, MIABIS_QUALITY_IDS } = require('../config/constants/specimen.constants');

/**
 * Valida se o valor está na escala MIABIS por id canônico
 * @param {number|string} value - Valor a ser validado
 * @returns {boolean} - true se válido, false caso contrário
 */
function validateQualityMIABIS(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  return MIABIS_QUALITY_IDS.includes(normalized);
}

/**
 * Valida e lança erro se o valor não estiver na escala MIABIS
 * @param {number|string} value - Valor a ser validado
 * @throws {Error} - Se o valor não estiver na escala MIABIS
 */
function validateQualityMIABISOrThrow(value) {
  if (!validateQualityMIABIS(value)) {
    throw new Error(`Valor de qualidade inválido. A escala MIABIS aceita apenas: ${MIABIS_QUALITY.map((quality) => `${quality.id} (${quality.label})`).join(', ')}. Valor recebido: ${value}`);
  }
}

/**
 * Converte valor para id MIABIS válido.
 * @param {string|number} value - Valor a converter
 * @returns {string|null} - Id MIABIS válido ou null se inválido
 */
function parseQualityMIABIS(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (MIABIS_QUALITY_IDS.includes(trimmed)) {
      return trimmed;
    }

    const legacyMap = {
      '0': 'UNKNOWN',
      '1': 'GOOD',
      '2': 'COMPROMISED',
    };

    return legacyMap[trimmed] || null;
  }

  if (typeof value === 'number') {
    const legacyMap = {
      0: 'UNKNOWN',
      1: 'GOOD',
      2: 'COMPROMISED',
    };

    return legacyMap[value] || null;
  }
  
  return null;
}

/**
 * Retorna a descrição do valor MIABIS em português
 * @param {string} value - Id MIABIS
 * @returns {string} - Descrição em português
 */
function getQualityMIABISDescriptionPT(value) {
  const quality = MIABIS_QUALITY.find((item) => item.id === String(value));
  return quality ? quality.label : 'Inválido';
}

/**
 * Retorna a descrição do valor MIABIS em inglês
 * @param {string} value - Id MIABIS
 * @returns {string} - Descrição em inglês
 */
function getQualityMIABISDescriptionEN(value) {
  switch (String(value)) {
    case 'GOOD':
      return 'Suitable';
    case 'COMPROMISED':
      return 'Compromised';
    case 'UNKNOWN':
      return 'Not assessed';
    default:
      return 'Invalid';
  }
}

module.exports = {
  validateQualityMIABIS,
  validateQualityMIABISOrThrow,
  parseQualityMIABIS,
  getQualityMIABISDescriptionPT,
  getQualityMIABISDescriptionEN
};

