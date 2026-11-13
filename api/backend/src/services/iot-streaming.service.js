const logger = require('../utils/logger');
const { getQueue } = require('../config/queue');
const influxTelemetryWriteRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const {
  readingIdentityOf,
  screenReading,
  findClientReplay,
  recordClientReplay,
  clientContractFieldsOf,
} = require('./telemetryReadingContract');

/**
 * Serviço de IoT Streaming para Temperature Control
 * Processa dados de temperatura em tempo real via WebSocket
 */

class IoTStreamingService {
  constructor() {
    this.io = null;
    this.activeStreams = new Map(); // Map<deviceId, streamInfo>
  }

  /**
   * Inicializa Socket.IO para IoT
   */
  initSocketIO(server) {
    if (this.io) {
      return this.io;
    }

    const { Server } = require('socket.io');
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST'],
      },
      path: '/iot',
    });

    this.io.on('connection', (socket) => {
      logger.info(`✅ Cliente IoT conectado: ${socket.id}`);

      // Registra dispositivo
      socket.on('register-device', async (data) => {
        await this.handleDeviceRegistration(socket, data);
      });

      // Recebe dados de temperatura
      socket.on('temperature-data', async (data) => {
        await this.handleTemperatureData(socket, data);
      });

      // Desconexão
      socket.on('disconnect', () => {
        this.handleDeviceDisconnection(socket);
      });
    });

    logger.info('✅ Serviço IoT Streaming inicializado');
    return this.io;
  }

  /**
   * Registra dispositivo IoT
   */
  async handleDeviceRegistration(socket, data) {
    try {
      const { deviceId, sensorId, locationId, facility, zone } = data;

      if (!deviceId || !sensorId) {
        socket.emit('error', { message: 'deviceId e sensorId são obrigatórios' });
        return;
      }

      this.activeStreams.set(deviceId, {
        socketId: socket.id,
        sensorId,
        locationId,
        facility,
        zone,
        connectedAt: new Date(),
      });

      socket.join(`device-${deviceId}`);
      socket.emit('device-registered', {
        deviceId,
        message: 'Dispositivo registrado com sucesso',
      });

      logger.info(`✅ Dispositivo IoT registrado: ${deviceId}`);
    } catch (error) {
      logger.error('Erro ao registrar dispositivo IoT:', error);
      socket.emit('error', { message: error.message });
    }
  }

  /**
   * Processa dados de temperatura recebidos
   */
  async handleTemperatureData(socket, data) {
    try {
      const { deviceId, temperature, timestamp, batteryLevel, signalQuality } = data;

      if (!deviceId || temperature === undefined) {
        socket.emit('error', { message: 'deviceId e temperature são obrigatórios' });
        return;
      }

      const streamInfo = this.activeStreams.get(deviceId);
      if (!streamInfo) {
        socket.emit('error', { message: 'Dispositivo não registrado' });
        return;
      }

      // Cria registro de temperatura
      const temperatureData = {
        sensorId: streamInfo.sensorId,
        temperatureValue: parseFloat(temperature),
        temperatureUnit: '°C',
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        readingStatus: 'valid',
        sensorStatus: 'normal',
        signalQuality: signalQuality || null,
        batteryLevel: batteryLevel ? parseInt(batteryLevel, 10) : null,
        locationId: streamInfo.locationId,
        facility: streamInfo.facility,
        zone: streamInfo.zone,
        // RF009 AC7 (#1317): the client's idempotencyKey and provenance.
        ...clientContractFieldsOf(data),
        source: 'iot-streaming',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Adiciona job na fila para processamento assíncrono
      const queue = getQueue();
      const jobId = `temp-iot-${Date.now()}-${deviceId}`;

      await queue.add(
        'temperature-iot',
        {
          jobID: jobId,
          dataType: 'temperature-iot',
          temperatureData,
          deviceId,
        },
        {
          jobId,
          priority: 5, // Alta prioridade para dados em tempo real
        }
      );

      // Confirma recebimento
      socket.emit('temperature-received', {
        deviceId,
        timestamp: temperatureData.timestamp,
        message: 'Dados de temperatura recebidos',
      });

      logger.debug(`📊 Dados de temperatura recebidos do dispositivo ${deviceId}: ${temperature}°C`);
    } catch (error) {
      logger.error('Erro ao processar dados de temperatura:', error);
      socket.emit('error', { message: error.message });
    }
  }

  /**
   * Trata desconexão de dispositivo
   */
  handleDeviceDisconnection(socket) {
    // Remove dispositivo dos streams ativos
    for (const [deviceId, streamInfo] of this.activeStreams.entries()) {
      if (streamInfo.socketId === socket.id) {
        this.activeStreams.delete(deviceId);
        logger.info(`❌ Dispositivo IoT desconectado: ${deviceId}`);
        break;
      }
    }
  }

  /**
   * Processa dados de temperatura (chamado pelo worker)
   */
  async processTemperatureData(db, temperatureData, { strippedFields = [] } = {}) {
    try {
      // #1317 (RF009 AC1-AC3): the same reading contract as the temperature
      // route. The fields the server adds are not part of the received
      // payload's hash; InfluxDB is the reading's only store (#1391), and a
      // failed write throws with nothing stored.
      const { source: _source, createdAt: _createdAt, updatedAt: _updatedAt, ...received } = temperatureData;
      const identity = readingIdentityOf(received, new Date(), { ingestionService: temperatureData.source === 'mqtt' ? 'mqtt' : 'iot-queue' });
      // RF009 AC7 (#1317, #1391): a client key already recorded for this
      // sensor in RF029's key store is a replay, as on the temperature route;
      // it returns the first reading's telemetryReadingId and writes nothing.
      // The scope is the one the temperature route and POST
      // /api/iot/telemetry use, so one key replays across all four paths.
      const prior = await findClientReplay(db, identity, received);
      if (prior) {
        logger.debug(`♻️ Leitura já registrada com este idempotencyKey: ${prior.telemetryReadingId}`);
        return prior.telemetryReadingId;
      }
      // RF009 AC7: a drift or an implausible value is recorded as a
      // TelemetryValidationIssue; an implausible value throws a 422 here.
      await screenReading(db, identity, received, { strippedFields });
      const reading = { ...temperatureData, ...identity, timestamp: identity.observedAt };
      reading.persistedAt = await influxTelemetryWriteRepository.writeTemperatureReadingNow(reading);

      // RF009 AC7 (#1391): a concurrent send that recorded the key first
      // wins; this one returns the winner's id. InfluxDB, the reading's only
      // store, already holds this send's point.
      const winner = await recordClientReplay(db, identity, received, reading.persistedAt);
      if (winner) return winner.telemetryReadingId;

      logger.debug(`✅ Dados de temperatura processados: ${identity.telemetryReadingId}`);
      return identity.telemetryReadingId;
    } catch (error) {
      logger.error('Erro ao processar dados de temperatura:', error);
      throw error;
    }
  }

  /**
   * Obtém streams ativos
   */
  getActiveStreams() {
    return Array.from(this.activeStreams.entries()).map(([deviceId, info]) => ({
      deviceId,
      sensorId: info.sensorId,
      locationId: info.locationId,
      connectedAt: info.connectedAt,
    }));
  }
}

module.exports = new IoTStreamingService();

