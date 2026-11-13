const mqtt = require('mqtt');
const fs = require('fs');
const logger = require('../utils/logger');
const iotStreamingService = require('./iot-streaming.service');
const mqttSignatureService = require('./mqtt-signature.service');
const mqttIngestionAuditService = require('./mqtt-ingestion-audit.service');
const { clientContractFieldsOf, splitContractFields } = require('./telemetryReadingContract');

// RF009 AC8, RNF004 C7 (#1540): every top-level field handleMessage reads,
// and organizationId (V2E-0561). Any other field is stripped and flags the
// reading with a personal_data_stripped issue.
const MQTT_READING_FIELDS = [
  'sensorId', 'sensorID', 'deviceId', 'temperatureValue', 'temperature', 'value', 'temperatureUnit', 'timestamp',
  'readingStatus', 'sensorStatus', 'signalQuality', 'batteryLevel', 'locationId', 'locationID', 'facility', 'zone',
  'signature', 'hmac', 'payloadSignature',
  'idempotencyKey', 'sourceEventId', 'deviceMessageId', 'traceId', 'sequenceNumber', 'organizationId',
];

class MqttTelemetryService {
  constructor() {
    this.client = null;
    this.started = false;
  }

  isEnabled() {
    const raw = String(process.env.MQTT_ENABLED || '').trim().toLowerCase();
    return raw === 'true' || raw === '1';
  }

  getConfig() {
    const url = process.env.MQTT_URL || '';
    const topic = process.env.MQTT_TOPIC || 'bioavanced/telemetry/temperature/#';

    const readOptionalFile = (filePath) => {
      if (!filePath) return undefined;
      try {
        return fs.readFileSync(filePath);
      } catch (error) {
        logger.warn(`[ISO20387][MQTT] Não foi possível ler arquivo TLS: ${filePath}`);
        return undefined;
      }
    };

    return {
      url,
      topic,
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      clientId: process.env.MQTT_CLIENT_ID || `bioavanced-backend-${Date.now()}`,
      tlsEnabled: String(process.env.MQTT_TLS_ENABLED || '').trim().toLowerCase() === 'true',
      rejectUnauthorized: String(process.env.MQTT_TLS_REJECT_UNAUTHORIZED || 'true').trim().toLowerCase() !== 'false',
      ca: readOptionalFile(process.env.MQTT_CA_PATH),
      cert: readOptionalFile(process.env.MQTT_CERT_PATH),
      key: readOptionalFile(process.env.MQTT_KEY_PATH),
      signatureRequired: String(process.env.MQTT_SIGNATURE_REQUIRED || '').trim().toLowerCase() === 'true'
    };
  }

  async start(db) {
    if (this.started) {
      return;
    }

    if (!this.isEnabled()) {
      logger.info('ingestão MQTT desabilitada');
      return;
    }

    const config = this.getConfig();
    if (!config.url) {
      logger.warn('[ISO20387][MQTT] MQTT_ENABLED=true, mas MQTT_URL não configurada');
      return;
    }

    const connectionOptions = {
      username: config.username,
      password: config.password,
      clientId: config.clientId,
      reconnectPeriod: 5000,
      clean: true
    };

    if (config.tlsEnabled) {
      connectionOptions.rejectUnauthorized = config.rejectUnauthorized;
      if (config.ca) connectionOptions.ca = config.ca;
      if (config.cert) connectionOptions.cert = config.cert;
      if (config.key) connectionOptions.key = config.key;
    }

    try {
      this.client = mqtt.connect(config.url, connectionOptions);
    } catch (error) {
      logger.error('[ISO20387][MQTT] Falha controlada ao conectar broker MQTT:', error.message || error);
      this.client = null;
      this.started = false;
      return;
    }

    this.client.on('connect', () => {
      this.client.subscribe(config.topic, (error) => {
        if (error) {
          logger.error('[ISO20387][MQTT] Falha ao assinar tópico MQTT:', error.message || error);
          return;
        }

        logger.info(`[ISO20387][MQTT] Assinado tópico de telemetria: ${config.topic}`);
      });
    });

    this.client.on('error', (error) => {
      logger.error('[ISO20387][MQTT] Erro no cliente MQTT:', error.message || error);
    });

    this.client.on('message', async (topic, payloadBuffer) => {
      await this.handleMessage(db, topic, payloadBuffer, config.signatureRequired);
    });

    this.started = true;
    logger.info('[ISO20387][MQTT] Serviço de ingestão MQTT inicializado');
  }

  async handleMessage(db, topic, payloadBuffer, signatureRequired = false) {
    try {
      const raw = payloadBuffer?.toString?.('utf8') || '';
      if (!raw) {
        return;
      }

      const payload = JSON.parse(raw);
      const payloadHash = mqttSignatureService.hashPayload(raw);
      const payloadSignature = payload.signature || payload.hmac || payload.payloadSignature || null;
      const signatureVerified = payloadSignature ? mqttSignatureService.verifyHmac(raw, payloadSignature) : false;

      if (signatureRequired && !payloadSignature) {
        await mqttIngestionAuditService.append(db, {
          topic,
          payloadHash,
          payloadSignature: null,
          signatureRequired,
          signatureVerified: false,
          status: 'rejected',
          reason: 'missing_signature'
        });
        logger.warn('[ISO20387][MQTT] Payload rejeitado: assinatura obrigatória ausente');
        return;
      }

      if (payloadSignature && !signatureVerified) {
        await mqttIngestionAuditService.append(db, {
          topic,
          payloadHash,
          payloadSignature,
          signatureRequired,
          signatureVerified: false,
          status: 'rejected',
          reason: 'invalid_signature'
        });
        logger.warn('[ISO20387][MQTT] Payload rejeitado: assinatura inválida');
        return;
      }

      const temperatureData = {
        sensorId: payload.sensorId || payload.sensorID || payload.deviceId || null,
        temperatureValue: Number(payload.temperatureValue ?? payload.temperature ?? payload.value),
        temperatureUnit: payload.temperatureUnit || '°C',
        // #1317: no device time stays null, so the reading's clockStatus is
        // unknown and its observedAt the receipt time, not a trusted guess.
        timestamp: payload.timestamp ? new Date(payload.timestamp) : null,
        readingStatus: payload.readingStatus || 'valid',
        sensorStatus: payload.sensorStatus || 'normal',
        signalQuality: payload.signalQuality || null,
        batteryLevel: payload.batteryLevel !== undefined && payload.batteryLevel !== null
          ? Number(payload.batteryLevel)
          : null,
        locationId: payload.locationId || payload.locationID || null,
        facility: payload.facility || null,
        zone: payload.zone || null,
        // RF009 AC7 (#1317): the client's idempotencyKey and provenance, so a
        // resent message replays the stored reading. On a replay the audit
        // row below records `processed` with the stored id, which shows the
        // duplicate.
        ...clientContractFieldsOf(payload),
        source: 'mqtt',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (!temperatureData.sensorId || !Number.isFinite(temperatureData.temperatureValue)) {
        await mqttIngestionAuditService.append(db, {
          topic,
          payloadHash,
          payloadSignature,
          signatureRequired,
          signatureVerified: payloadSignature ? signatureVerified : !signatureRequired,
          status: 'rejected',
          reason: 'invalid_payload'
        });
        logger.warn('[ISO20387][MQTT] Payload inválido de telemetria descartado');
        return;
      }

      const { strippedFields } = splitContractFields(payload, MQTT_READING_FIELDS);
      const insertedId = await iotStreamingService.processTemperatureData(db, temperatureData, { strippedFields });

      await mqttIngestionAuditService.append(db, {
        topic,
        payloadHash,
        payloadSignature,
        signatureRequired,
        signatureVerified: payloadSignature ? signatureVerified : !signatureRequired,
        status: 'processed',
        reason: null,
        sensorId: temperatureData.sensorId,
        temperatureValue: temperatureData.temperatureValue,
        readingTimestamp: temperatureData.timestamp,
        temperatureDataId: insertedId || null
      });
    } catch (error) {
      logger.error('[ISO20387][MQTT] Falha ao processar payload MQTT:', error.message || error);
    }
  }

  async stop() {
    if (!this.client) {
      return;
    }

    await new Promise((resolve) => {
      this.client.end(false, resolve);
    });

    this.client = null;
    this.started = false;
    logger.info('[ISO20387][MQTT] Serviço MQTT encerrado');
  }
}

module.exports = new MqttTelemetryService();
