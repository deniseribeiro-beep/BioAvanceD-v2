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

    // #1145: the temperature policy is bound on the sensor's SensorMetadata,
    // and createSensor only creates that row when a macAddress is given. A
    // policy without one used to be dropped silently, leaving a sensor that
    // looked governed and was not, so it is refused here instead.
    if (data.temperaturePolicy && !data.macAddress) {
      errors.push('temperaturePolicy exige macAddress: a política é vinculada ao SensorMetadata do sensor');
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
      // #634: Organization.organizationId (UUID string), not a Mongo ref --
      // same shape as Sample.collectionSite/Patient.clinicalUnitId. No
      // backfill for pre-existing sensors (null = unscoped/legacy).
      organizationId: data.organizationId || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = SensorModel;

