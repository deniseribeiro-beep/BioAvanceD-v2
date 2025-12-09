/**
 * Validador de qualidade MIABIS
 * Escala oficial adotada pelos biobancos internacionais:
 * 0 - Não avaliada (Not assessed)
 * 1 - Adequada (Suitable)
 * 2 - Inadequada (Not suitable)
 */

/**
 * Valida se o valor está na escala MIABIS (0, 1 ou 2)
 * @param {number|string} value - Valor a ser validado
 * @returns {boolean} - true se válido, false caso contrário
 */
function validateQualityMIABIS(value) {
  // Converte para número se for string
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
  
  // Verifica se é um número inteiro válido
  if (typeof numValue !== 'number' || !Number.isInteger(numValue)) {
    return false;
  }
  
  // Verifica se está na escala MIABIS (0, 1 ou 2)
  return numValue === 0 || numValue === 1 || numValue === 2;
}

/**
 * Valida e lança erro se o valor não estiver na escala MIABIS
 * @param {number|string} value - Valor a ser validado
 * @throws {Error} - Se o valor não estiver na escala MIABIS
 */
function validateQualityMIABISOrThrow(value) {
  if (!validateQualityMIABIS(value)) {
    throw new Error(`Valor de qualidade inválido. A escala MIABIS aceita apenas: 0 (Não avaliada), 1 (Adequada) ou 2 (Inadequada). Valor recebido: ${value}`);
  }
}

/**
 * Converte string para número MIABIS válido
 * Aceita strings "0", "1", "2" e converte para inteiro
 * @param {string|number} value - Valor a converter
 * @returns {number|null} - Número MIABIS válido ou null se inválido
 */
function parseQualityMIABIS(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  
  // Se já for número, valida diretamente
  if (typeof value === 'number') {
    return validateQualityMIABIS(value) ? value : null;
  }
  
  // Se for string, tenta converter
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Aceita apenas "0", "1" ou "2" (não aceita textos como "Alta", "Boa", etc)
    if (trimmed === '0' || trimmed === '1' || trimmed === '2') {
      return parseInt(trimmed, 10);
    }
  }
  
  return null;
}

/**
 * Retorna a descrição do valor MIABIS em português
 * @param {number} value - Valor MIABIS (0, 1 ou 2)
 * @returns {string} - Descrição em português
 */
function getQualityMIABISDescriptionPT(value) {
  switch (value) {
    case 0:
      return 'Não avaliada';
    case 1:
      return 'Adequada';
    case 2:
      return 'Inadequada';
    default:
      return 'Inválido';
  }
}

/**
 * Retorna a descrição do valor MIABIS em inglês
 * @param {number} value - Valor MIABIS (0, 1 ou 2)
 * @returns {string} - Descrição em inglês
 */
function getQualityMIABISDescriptionEN(value) {
  switch (value) {
    case 0:
      return 'Not assessed';
    case 1:
      return 'Suitable';
    case 2:
      return 'Not suitable';
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

