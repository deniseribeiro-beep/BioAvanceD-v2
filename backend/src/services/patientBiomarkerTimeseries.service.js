const { Point } = require('@influxdata/influxdb-client');
const logger = require('../utils/logger');
const biomarkerIntegrityService = require('./biomarker-integrity.service');
const {
  connectInfluxDB,
  getInfluxWriteApi
} = require('../infrastructure/database/influxdb/connection');

class PatientBiomarkerTimeseriesService {
  toNumeric(value) {
    if (value === undefined || value === null || value === '') return null;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return numericValue;
  }

  async writePatientBiomarkers({ db, patient, eventType = 'update' } = {}) {
    if (!patient) return;

    const patientID = String(patient.patientID || '').trim();
    if (!patientID) return;

    const alphaGal = this.toNumeric(patient.alphaGal);
    const lysoGb3 = this.toNumeric(patient.lysoGb3);

    if (alphaGal === null && lysoGb3 === null) {
      return;
    }

    const pointTimestamp = patient.updatedAt ? new Date(patient.updatedAt) : new Date();

    try {
      await connectInfluxDB();
      const writeApi = getInfluxWriteApi();

      const point = new Point('patient_biomarkers')
        .tag('patientId', patientID)
        .tag('eventType', String(eventType || 'update'));

      if (patient.clinicalUnit) {
        point.tag('clinicalUnit', String(patient.clinicalUnit));
      }

      if (alphaGal !== null) {
        point.floatField('alphaGal', alphaGal);
      }

      if (lysoGb3 !== null) {
        point.floatField('lysoGb3', lysoGb3);
      }

      point.timestamp(pointTimestamp);

      writeApi.writePoint(point);
      await writeApi.flush();
    } catch (error) {
      logger.warn(`[ISO20387][INFLUXDB][PATIENT_BIOMARKERS] Falha ao persistir biomarcadores do paciente ${patientID}: ${error.message}`);
    }

    if (db) {
      try {
        const hashWrites = [];

        if (alphaGal !== null) {
          hashWrites.push(
            biomarkerIntegrityService.appendBiomarkerHash(db, {
              patientId: patientID,
              biomarkerType: 'alphaGal',
              value: alphaGal,
              timestamp: pointTimestamp,
              source: 'patient_biomarkers',
              eventType
            })
          );
        }

        if (lysoGb3 !== null) {
          hashWrites.push(
            biomarkerIntegrityService.appendBiomarkerHash(db, {
              patientId: patientID,
              biomarkerType: 'lysoGb3',
              value: lysoGb3,
              timestamp: pointTimestamp,
              source: 'patient_biomarkers',
              eventType
            })
          );
        }

        if (hashWrites.length > 0) {
          await Promise.all(hashWrites);
        }
      } catch (error) {
        logger.warn(`[ISO20387][BIOMARKER_INTEGRITY] Falha ao registrar hash de integridade do paciente ${patientID}: ${error.message}`);
      }
    }
  }
}

module.exports = new PatientBiomarkerTimeseriesService();
