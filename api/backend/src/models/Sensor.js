/**
 * Modelo de validação e estrutura para Sensor
 */
class SensorModel {
  static validate(data) {
    const errors = [];

    if (!data.sensorId && !data.sensorID) {
      errors.push('sensorId é obrigatório');
    }

    if (!data.sensorType || typeof data.sensorType !== 'string') {
      errors.push('sensorType é obrigatório e deve ser string');
    }

    if (data.maintenanceStatus && !['operational', 'maintenance', 'calibration', 'error'].includes(data.maintenanceStatus)) {
      errors.push('maintenanceStatus inválido');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      sensorId: data.sensorId || data.sensorID, // String conforme dicionário
      sensorType: data.sensorType,
      sensorModel: data.sensorModel || null,
      maintenanceStatus: data.maintenanceStatus || 'operational',
      lastCalibration: data.lastCalibration ? (data.lastCalibration instanceof Date ? data.lastCalibration : new Date(data.lastCalibration)) : null, // DateTime ISO 8601
      nextCalibration: data.nextCalibration ? (data.nextCalibration instanceof Date ? data.nextCalibration : new Date(data.nextCalibration)) : null, // DateTime ISO 8601
      calibrationCertificate: data.calibrationCertificate || null, // String - Código ou URL do certificado
      locationId: data.locationId || data.locationID || null, // String conforme dicionário
      policyId: data.policyId || data.policyID || null, // String conforme dicionário
      macAddress: data.macAddress || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = SensorModel;

