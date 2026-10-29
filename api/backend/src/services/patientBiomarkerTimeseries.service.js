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

    const participantId = String(patient.participantId || '').trim();
    if (!participantId) return;

    const biomarkerEntries = Array.isArray(patient.biomarkers)
      ? patient.biomarkers
      : Array.isArray(patient.biomarkerObservations)
        ? patient.biomarkerObservations
        : [];

    const normalizedEntries = biomarkerEntries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const biomarkerType = String(entry.biomarkerType || entry.type || '').trim();
        const unit = String(entry.unit || '').trim();
        const value = this.toNumeric(entry.value);
        if (!biomarkerType || value === null) return null;
        return { biomarkerType, unit: unit || null, value };
      })
      .filter(Boolean);

    if (normalizedEntries.length === 0) {
      return;
    }

    const pointTimestamp = patient.updatedAt ? new Date(patient.updatedAt) : new Date();

    try {
      await connectInfluxDB();
      const writeApi = getInfluxWriteApi({ requestScoped: true });

      const point = new Point('patient_biomarkers')
        .tag('participantId', participantId)
        .tag('eventType', String(eventType || 'update'));

      if (patient.clinicalUnit) {
        point.tag('clinicalUnit', String(patient.clinicalUnit));
      }

      for (const entry of normalizedEntries) {
        point.floatField(entry.biomarkerType, entry.value);
      }

      point.timestamp(pointTimestamp);

      writeApi.writePoint(point);
      await writeApi.flush();
    } catch (error) {
      logger.warn(`[ISO20387][INFLUXDB][PATIENT_BIOMARKERS] Falha ao persistir biomarcadores do participante ${participantId}: ${error.message}`);
    }

    if (db) {
      try {
        const hashWrites = [];

        for (const entry of normalizedEntries) {
          hashWrites.push(
            biomarkerIntegrityService.appendBiomarkerHash(db, {
              participantId: participantId,
              biomarkerType: entry.biomarkerType,
              value: entry.value,
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
        logger.warn(`[ISO20387][BIOMARKER_INTEGRITY] Falha ao registrar hash de integridade do participante ${participantId}: ${error.message}`);
      }
    }
  }
}

module.exports = new PatientBiomarkerTimeseriesService();
