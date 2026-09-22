/**
 * Modelo de validação e estrutura para Policy (Política de Temperatura)
 */
class PolicyModel {
  static validate(data) {
    const errors = [];

    // #1089: dict-02 P1X-0106 profileName is 1..1 Core on ThresholdProfile,
    // and temperaturePolicies -- now this API's store -- requires `name`.
    // The API had no source for it, so a caller supplies policyName. This
    // is the REQUEST shape's validator; the canonical mapping itself lives
    // at the route boundary (policy.routes.js#toCanonical).
    if (typeof data.policyName !== 'string' || data.policyName.trim() === '') {
      errors.push('policyName é obrigatório e deve ser string não vazia');
    }

    if (data.minThreshold === undefined || typeof data.minThreshold !== 'number') {
      errors.push('minThreshold é obrigatório e deve ser number');
    }

    if (data.maxThreshold === undefined || typeof data.maxThreshold !== 'number') {
      errors.push('maxThreshold é obrigatório e deve ser number');
    }

    if (data.minThreshold >= data.maxThreshold) {
      errors.push('minThreshold deve ser menor que maxThreshold');
    }

    if (data.targetTemperature === undefined || typeof data.targetTemperature !== 'number') {
      errors.push('targetTemperature é obrigatório e deve ser number');
    }

    if (data.temperatureUnit && data.temperatureUnit !== '°C' && data.temperatureUnit !== '°F') {
      errors.push('temperatureUnit deve ser °C ou °F');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      policyId: data.policyId || data.policyID || null, // Int conforme dicionário
      minThreshold: data.minThreshold,
      maxThreshold: data.maxThreshold,
      targetTemperature: data.targetTemperature,
      hysteresis: data.hysteresis || 0.5,
      alertDelayMin: data.alertDelayMin || data.alertDelay || 5, // Int min conforme dicionário
      temperatureUnit: data.temperatureUnit || '°C', // °C, °F, K conforme dicionário
      validFrom: data.validFrom ? (data.validFrom instanceof Date ? data.validFrom : new Date(data.validFrom)) : new Date(), // DateTime
      validTo: data.validTo ? (data.validTo instanceof Date ? data.validTo : new Date(data.validTo)) : null, // DateTime
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  static validateThresholds(minThreshold, maxThreshold) {
    return minThreshold < maxThreshold;
  }
}

module.exports = PolicyModel;

