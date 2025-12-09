const importService = require('../../services/import.service');
const fhirService = require('../../services/fhir.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Temperatura
 * Processa importação de temperatura com suporte FHIR e IoT Streaming
 */

class TemperatureWorker {
  async process(db, jobID, filePath, options = {}) {
    const startTime = Date.now();
    let fhirResourcesCreated = 0;
    let fhirResourcesUpdated = 0;
    const fhirResources = [];

    try {
      // Verifica se arquivo existe
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
      }

      // Cria objeto file para compatibilidade com importService
      const file = {
        path: filePath,
        originalname: options.fileName || 'temperature.csv',
      };

      // Processa importação
      const results = await importService.importTemperature(db, file);

      // Converte para FHIR e atualiza/insere
      const temperaturesCollection = db.collection('temperatures');
      const recentTemperatures = await temperaturesCollection
        .find({
          createdAt: { $gte: new Date(startTime - 60000) }, // Último minuto
        })
        .sort({ createdAt: -1 })
        .limit(results.success)
        .toArray();

      for (const temperature of recentTemperatures) {
        try {
          // Converte para FHIR
          const fhirTemperature = fhirService.temperatureToFHIR(temperature);
          fhirService.validateFHIRResource(fhirTemperature.device);
          fhirService.validateFHIRResource(fhirTemperature.observation);

          // Verifica se device já existe
          const devicesCollection = db.collection('devices');
          let device = await devicesCollection.findOne({
            'fhir.identifier.value': temperature.sensorId?.toString(),
          });

          if (device) {
            // Update device
            await devicesCollection.updateOne(
              { _id: device._id },
              {
                $set: {
                  fhir: fhirTemperature.device,
                  updatedAt: new Date(),
                },
              }
            );
            fhirResourcesUpdated++;
          } else {
            // Insert device
            device = await devicesCollection.insertOne({
              sensorId: temperature.sensorId,
              fhir: fhirTemperature.device,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            fhirResourcesCreated++;
          }

          // Salva observation
          await temperaturesCollection.updateOne(
            { _id: temperature._id },
            {
              $set: {
                fhir: fhirTemperature.observation,
                fhirDevice: fhirTemperature.device,
              },
            }
          );

          fhirResources.push({
            resourceType: 'Device',
            id: fhirTemperature.device.id,
            resource: fhirTemperature.device,
          });

          fhirResources.push({
            resourceType: 'Observation',
            id: fhirTemperature.observation.id,
            resource: fhirTemperature.observation,
          });
        } catch (error) {
          logger.error(`Erro ao processar FHIR para temperatura ${temperature._id}:`, error);
          // Continua processamento mesmo com erro FHIR
        }
      }

      const processingTime = (Date.now() - startTime) / 1000;

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        processingTime,
        fhirResourcesCreated,
        fhirResourcesUpdated,
        fhirResources,
      };
    } catch (error) {
      logger.error('Erro no worker de temperatura:', error);
      throw error;
    }
  }
}

module.exports = new TemperatureWorker();

