const logger = require('../utils/logger');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');
const SensorMetadata = require('../models/SensorMetadata.schema');
const { saveTelemetryPoint } = require('../services/saveTelemetryPoint');
const { sendCriticalAlertEmail } = require('../services/sendCriticalAlertEmail');
const TemperatureIncidentModel = require('../models/TemperatureIncident');

const sensorPolicyCache = new Map();
const SENSOR_POLICY_CACHE_TTL_MS = 60 * 1000;

async function resolveTemperaturePolicy(sensorId) {
  const cacheKey = String(sensorId).trim();
  const cachedEntry = sensorPolicyCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.value;
  }

  await connectMongoDB();

  const sensorMetadata = await SensorMetadata
    .findOne({ sensorId: cacheKey })
    .populate('temperaturePolicy')
    .lean();

  const temperaturePolicy = sensorMetadata?.temperaturePolicy || null;
  const value = {
    sensorMetadata,
    temperaturePolicy
  };

  sensorPolicyCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + SENSOR_POLICY_CACHE_TTL_MS
  });

  return value;
}

async function ingestTelemetry(req, res) {
  try {
    const { sensorId, temperature, timestamp } = req.body || {};
    const normalizedSensorId = String(sensorId || '').trim();
    const normalizedTemperature = Number(temperature);
    const normalizedTimestamp = timestamp ? new Date(timestamp) : new Date();

    if (!normalizedSensorId || !Number.isFinite(normalizedTemperature)) {
      return res.status(400).json({
        success: false,
        error: 'sensorId e temperature são obrigatórios'
      });
    }

    void Promise.resolve()
      .then(() => saveTelemetryPoint(normalizedSensorId, normalizedTemperature, normalizedTimestamp))
      .catch((error) => {
        logger.error('[ISO20387][IOT] Falha ao persistir telemetria no InfluxDB:', error.message || error);
      });

    let policyData = null;
    try {
      policyData = await resolveTemperaturePolicy(normalizedSensorId);
    } catch (error) {
      logger.warn('[ISO20387][IOT] Não foi possível resolver política do sensor:', error.message || error);
    }

    const temperaturePolicy = policyData?.temperaturePolicy || null;

    if (temperaturePolicy) {
      const minTemp = Number(temperaturePolicy.minTemp);
      const maxTemp = Number(temperaturePolicy.maxTemp);

      if (Number.isFinite(minTemp) && Number.isFinite(maxTemp) && (
        normalizedTemperature < minTemp || normalizedTemperature > maxTemp
      )) {
        const recipientEmail =
          policyData?.sensorMetadata?.alertEmail ||
          policyData?.sensorMetadata?.notificationEmail ||
          process.env.ALERT_EMAIL_TO ||
          process.env.ADMIN_EMAIL ||
          '';

        console.log(
          '[ALERTA][IOT] Temperatura fora da política',
          JSON.stringify({
            sensorId: normalizedSensorId,
            temperature: normalizedTemperature,
            minTemp,
            maxTemp,
            policyId: String(temperaturePolicy._id || temperaturePolicy.id || ''),
            timestamp: normalizedTimestamp.toISOString()
          })
        );

        // Registrar incidente no MongoDB
        void Promise.resolve()
          .then(async () => {
            const db = await connectMongoDB();
            const TemperatureIncidentCollection = db.collection('temperatureIncidents');
            
            // Obter nome do sensor do metadata
            const sensorName = policyData?.sensorMetadata?.sensorName || normalizedSensorId;
            
            // Procurar por incidente aberto para este sensor
            const existingIncident = await TemperatureIncidentCollection.findOne({
              sensorKey: normalizedSensorId,
              status: { $in: ['open', 'acknowledged', 'escalated'] }
            });

            if (existingIncident) {
              // Atualizar incidente existente
              await TemperatureIncidentCollection.updateOne(
                { _id: existingIncident._id },
                {
                  $set: {
                    currentTemperature: normalizedTemperature,
                    maxTemperature: Math.max(existingIncident.maxTemperature, normalizedTemperature),
                    minTemperature: Math.min(existingIncident.minTemperature, normalizedTemperature),
                    samplesOutOfRange: existingIncident.samplesOutOfRange + 1,
                    updatedAt: new Date()
                  }
                }
              );
            } else {
              // Criar novo incidente
              const newIncident = TemperatureIncidentModel.create({
                sensorKey: normalizedSensorId,
                sensorName: sensorName,
                openedAt: normalizedTimestamp,
                currentTemperature: normalizedTemperature,
                maxTemperature: normalizedTemperature,
                minTemperature: normalizedTemperature,
                samplesOutOfRange: 1
              });

              const result = await TemperatureIncidentCollection.insertOne(newIncident);
              
              // Enviar email de alerta para novos incidentes
              const UserCollection = db.collection('users');
              const recipients = await UserCollection
                .find({ 
                  accessType: { $in: [2, 3, 4] },
                  status: 'active'
                })
                .project({ email: 1 })
                .toArray();

              const recipientEmails = recipients.map(u => u.email).filter(e => e);
              
              if (recipientEmails.length > 0) {
                const { sendIncidentAlertEmail } = require('../services/sendIncidentAlertEmail');
                void sendIncidentAlertEmail({ ...newIncident, _id: result.insertedId }, recipientEmails, 0)
                  .catch(err => {
                    logger.error('[IOT_INCIDENT] Erro ao enviar alerta de incidente:', err.message);
                  });
              }
            }
          })
          .catch((error) => {
            logger.error('[IOT_INCIDENT] Falha ao registrar incidente:', error.message || error);
          });

        if (recipientEmail) {
          void sendCriticalAlertEmail(
            normalizedSensorId,
            normalizedTemperature,
            maxTemp,
            recipientEmail
          ).catch((error) => {
            logger.error('[ISO20387][IOT] Falha ao enviar e-mail crítico via Resend:', error.message || error);
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      accepted: true
    });
  } catch (error) {
    logger.error('[ISO20387][IOT] Falha no controller de telemetria:', error.message || error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao processar telemetria',
      message: error.message
    });
  }
}

module.exports = {
  ingestTelemetry
};