/**
 * Modelo de validação e estrutura para Temperature
 * RF009 - Registro de Temperatura
 * Baseado no Dicionário Técnico Completo
 */
class TemperatureModel {
  static validate(data) {
    const errors = [];

    if (!data.sensorId && !data.sensorID) {
      errors.push('sensorId é obrigatório');
    }

    if (data.temperatureValue === undefined || typeof data.temperatureValue !== 'number' || Number.isNaN(data.temperatureValue)) {
      errors.push('temperatureValue é obrigatório e deve ser number');
    }

    if (data.temperatureUnit && !['°C', '°F', 'K'].includes(data.temperatureUnit)) {
      errors.push('temperatureUnit deve ser °C, °F ou K');
    }

    if (data.readingStatus && !['valid', 'invalid', 'suspicious'].includes(data.readingStatus)) {
      errors.push('readingStatus deve ser: valid, invalid ou suspicious');
    }

    if (data.sensorStatus && !['normal', 'faulty', 'maintenance'].includes(data.sensorStatus)) {
      errors.push('sensorStatus deve ser: normal, faulty ou maintenance');
    }

    if (data.signalQuality && !['excellent', 'good', 'poor', 'lost'].includes(data.signalQuality)) {
      errors.push('signalQuality deve ser: excellent, good, poor ou lost');
    }

    if (data.maintenanceStatus && !['ok', 'pending', 'overdue'].includes(data.maintenanceStatus)) {
      errors.push('maintenanceStatus deve ser: ok, pending ou overdue');
    }

    if (data.batteryLevel !== undefined && (data.batteryLevel < 0 || data.batteryLevel > 100)) {
      errors.push('batteryLevel deve ser entre 0 e 100');
    }

    if (data.dataQualityScore !== undefined && (data.dataQualityScore < 0 || data.dataQualityScore > 1)) {
      errors.push('dataQualityScore deve ser entre 0 e 1');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      logId: data.logId || data.logID || null, // String conforme dicionário
      timestamp: data.timestamp || new Date(), // DateTime ISO 8601
      sensorId: data.sensorId || data.sensorID, // String
      sensorName: data.sensorName || null,
      sensorModel: data.sensorModel || null,
      sensorType: data.sensorType || null, // thermocouple, RTD, thermistor
      locationId: data.locationId || data.locationID || null, // String
      locationName: data.locationName || null,
      facility: data.facility || null,
      zone: data.zone || null,
      temperatureValue: data.temperatureValue, // Float °C
      temperatureUnit: data.temperatureUnit || '°C', // °C, °F, K
      precision: data.precision || null, // Float - Precisão do sensor em graus Celsius
      minThreshold: data.minThreshold || null, // Float °C - Da Policy
      maxThreshold: data.maxThreshold || null, // Float °C - Da Policy
      targetTemperature: data.targetTemperature || null, // Float °C - Da Policy
      hysteresis: data.hysteresis || null, // Float °C - Da Policy
      alertDelay: data.alertDelay || null, // Int min - Da Policy
      readingStatus: data.readingStatus || 'valid', // valid, invalid, suspicious
      sensorStatus: data.sensorStatus || 'normal', // normal, faulty, maintenance
      signalQuality: data.signalQuality || null, // excellent, good, poor, lost
      batteryLevel: data.batteryLevel || null, // Int %
      errorCode: data.errorCode || null,
      errorMessage: data.errorMessage || null,
      lastCalibration: data.lastCalibration ? (data.lastCalibration instanceof Date ? data.lastCalibration : new Date(data.lastCalibration)) : null, // DateTime ISO 8601
      nextCalibration: data.nextCalibration ? (data.nextCalibration instanceof Date ? data.nextCalibration : new Date(data.nextCalibration)) : null, // DateTime ISO 8601
      calibrationCertificate: data.calibrationCertificate || null,
      maintenanceStatus: data.maintenanceStatus || null, // ok, pending, overdue
      dataQualityScore: data.dataQualityScore || null, // Float 0-1
      operatorId: data.operatorId || null, // String
      // #636: Organization.organizationId (UUID string), not a Mongo ref --
      // same shape as Sample.collectionSite/Sensor.organizationId (#634)/
      // Equipment.organizationId (#635). No backfill for pre-existing
      // readings (null = unscoped/legacy) -- fuzzy-matching facility/zone
      // was explicitly decided against per F3-G09.
      organizationId: data.organizationId || null,
      createdAt: new Date()
    };
  }

  static validateReading(temperatureValue, minThreshold, maxThreshold) {
    return temperatureValue >= minThreshold && temperatureValue <= maxThreshold;
  }

  static validateTemperatureUnit(unit) {
    return ['°C', '°F', 'K'].includes(unit);
  }

  // #1198: a reading may be recorded in any unit validateTemperatureUnit
  // accepts, while policy limits are Celsius. Compare in Celsius; the reading
  // itself is stored as recorded.
  static toCelsius(value, unit) {
    if (unit === '°F') return (value - 32) * 5 / 9;
    if (unit === 'K') return value - 273.15;
    return value;
  }

  /**
   * Gera alerta se a leitura exceder os limites
   */
  static shouldGenerateAlert(temperatureValue, minThreshold, maxThreshold, alertDelay) {
    if (!minThreshold || !maxThreshold) return false;
    return temperatureValue < minThreshold || temperatureValue > maxThreshold;
  }
}

module.exports = TemperatureModel;
