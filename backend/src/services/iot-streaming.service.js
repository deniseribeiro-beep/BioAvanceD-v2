const fhirService = require('./fhir.service');
const logger = require('../utils/logger');
const { getQueue } = require('../config/queue');

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
  async processTemperatureData(db, temperatureData) {
    try {
      const temperaturesCollection = db.collection('temperatures');

      // Insere registro
      const result = await temperaturesCollection.insertOne(temperatureData);

      // Converte para FHIR
      const fhirTemperature = fhirService.temperatureToFHIR(temperatureData);
      fhirService.validateFHIRResource(fhirTemperature.device);
      fhirService.validateFHIRResource(fhirTemperature.observation);

      // Atualiza com FHIR
      await temperaturesCollection.updateOne(
        { _id: result.insertedId },
        {
          $set: {
            fhir: fhirTemperature.observation,
            fhirDevice: fhirTemperature.device,
          },
        }
      );

      // Atualiza/Insere device
      const devicesCollection = db.collection('devices');
      const existingDevice = await devicesCollection.findOne({
        'fhir.identifier.value': temperatureData.sensorId?.toString(),
      });

      if (existingDevice) {
        await devicesCollection.updateOne(
          { _id: existingDevice._id },
          {
            $set: {
              fhir: fhirTemperature.device,
              updatedAt: new Date(),
            },
          }
        );
      } else {
        await devicesCollection.insertOne({
          sensorId: temperatureData.sensorId,
          fhir: fhirTemperature.device,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      logger.debug(`✅ Dados de temperatura processados: ${result.insertedId}`);
      return result.insertedId;
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

