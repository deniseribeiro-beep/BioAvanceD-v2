const mqtt = require('mqtt');
const logger = require('../utils/logger');
const iotStreamingService = require('./iot-streaming.service');

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

    return {
      url,
      topic,
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      clientId: process.env.MQTT_CLIENT_ID || `bioavanced-backend-${Date.now()}`
    };
  }

  async start(db) {
    if (this.started) {
      return;
    }

    if (!this.isEnabled()) {
      logger.info('[ISO20387][MQTT] Ingestão MQTT desabilitada (MQTT_ENABLED=false)');
      return;
    }

    const config = this.getConfig();
    if (!config.url) {
      logger.warn('[ISO20387][MQTT] MQTT_ENABLED=true, mas MQTT_URL não configurada');
      return;
    }

    this.client = mqtt.connect(config.url, {
      username: config.username,
      password: config.password,
      clientId: config.clientId,
      reconnectPeriod: 5000,
      clean: true
    });

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

    this.client.on('message', async (_topic, payloadBuffer) => {
      await this.handleMessage(db, payloadBuffer);
    });

    this.started = true;
    logger.info('[ISO20387][MQTT] Serviço de ingestão MQTT inicializado');
  }

  async handleMessage(db, payloadBuffer) {
    try {
      const raw = payloadBuffer?.toString?.('utf8') || '';
      if (!raw) {
        return;
      }

      const payload = JSON.parse(raw);

      const temperatureData = {
        sensorId: payload.sensorId || payload.sensorID || payload.deviceId || null,
        temperatureValue: Number(payload.temperatureValue ?? payload.temperature ?? payload.value),
        temperatureUnit: payload.temperatureUnit || '°C',
        timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        readingStatus: payload.readingStatus || 'valid',
        sensorStatus: payload.sensorStatus || 'normal',
        signalQuality: payload.signalQuality || null,
        batteryLevel: payload.batteryLevel !== undefined && payload.batteryLevel !== null
          ? Number(payload.batteryLevel)
          : null,
        locationId: payload.locationId || payload.locationID || null,
        facility: payload.facility || null,
        zone: payload.zone || null,
        source: 'mqtt',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (!temperatureData.sensorId || !Number.isFinite(temperatureData.temperatureValue)) {
        logger.warn('[ISO20387][MQTT] Payload inválido de telemetria descartado');
        return;
      }

      await iotStreamingService.processTemperatureData(db, temperatureData);
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