const importLGPDService = require('../../services/import-lgpd.service');
const fhirService = require('../../services/fhir.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Amostras
 * Processa importação de amostras com suporte FHIR
 */

class SampleWorker {
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

      // Cria objeto file para compatibilidade com importLGPDService
      const file = {
        path: filePath,
        originalname: options.fileName || 'samples.csv',
      };

      // Processa importação
      const results = await importLGPDService.importSamples(db, file, {
        startLocationID: options.startLocationID,
        autoIncrement: options.autoIncrement,
        groupFields: options.groupFields || {},
      });

      // Converte para FHIR e atualiza/insere
      const samplesCollection = db.collection('amostras');
      const recentSamples = await samplesCollection
        .find({
          createdAt: { $gte: new Date(startTime - 60000) }, // Último minuto
        })
        .sort({ createdAt: -1 })
        .limit(results.success)
        .toArray();

      for (const sample of recentSamples) {
        try {
          // Busca referência do paciente
          const patientsCollection = db.collection('pacientes');
          const patient = await patientsCollection.findOne({
            patientID: sample.patientID,
          });

          const patientReference = patient
            ? {
                reference: `Patient/${patient.patientID || patient._id}`,
              }
            : null;

          // Converte para FHIR
          const fhirSpecimen = fhirService.sampleToFHIR(sample, patientReference);
          fhirService.validateFHIRResource(fhirSpecimen);

          // Verifica se já existe por identifier
          const existing = await fhirService.findResourceByIdentifier(
            db,
            'amostras',
            'http://bioavanced.local/sample-id',
            sample.sampleID || sample._id
          );

          if (existing) {
            // Update
            await samplesCollection.updateOne(
              { _id: sample._id },
              {
                $set: {
                  fhir: fhirSpecimen,
                  updatedAt: new Date(),
                },
              }
            );
            fhirResourcesUpdated++;
          } else {
            // Insert
            await samplesCollection.updateOne(
              { _id: sample._id },
              {
                $set: {
                  fhir: fhirSpecimen,
                },
              }
            );
            fhirResourcesCreated++;
          }

          fhirResources.push({
            resourceType: 'Specimen',
            id: fhirSpecimen.id,
            resource: fhirSpecimen,
          });
        } catch (error) {
          logger.error(`Erro ao processar FHIR para amostra ${sample._id}:`, error);
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
      logger.error('Erro no worker de amostras:', error);
      throw error;
    }
  }
}

module.exports = new SampleWorker();

