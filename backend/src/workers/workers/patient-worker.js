const importLGPDService = require('../../services/import-lgpd.service');
const fhirService = require('../../services/fhir.service');
const logger = require('../../utils/logger');
const fs = require('fs');

/**
 * Worker de Importação de Pacientes
 * Processa importação de pacientes com suporte FHIR
 */

class PatientWorker {
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
        originalname: options.fileName || 'patients.csv',
      };

      // Processa importação
      const results = await importLGPDService.importPatients(db, file);

      // Converte para FHIR e atualiza/insere
      const patientsCollection = db.collection('pacientes');
      const processedPatients = [];

      // Processa apenas pacientes que foram inseridos com sucesso
      // Nota: importLGPDService não retorna os IDs dos pacientes inseridos por LGPD
      // Vamos buscar os pacientes recém-inseridos por timestamp
      const recentPatients = await patientsCollection
        .find({
          createdAt: { $gte: new Date(startTime - 60000) }, // Último minuto
        })
        .sort({ createdAt: -1 })
        .limit(results.success)
        .toArray();

      for (const patient of recentPatients) {
        try {
          // Converte para FHIR
          const fhirPatient = fhirService.patientToFHIR(patient);
          fhirService.validateFHIRResource(fhirPatient);

          // Verifica se já existe por identifier
          const existing = await fhirService.findResourceByIdentifier(
            db,
            'pacientes',
            'http://bioavanced.local/patient-id',
            patient.patientID || patient._id
          );

          if (existing) {
            // Update
            await patientsCollection.updateOne(
              { _id: patient._id },
              {
                $set: {
                  fhir: fhirPatient,
                  updatedAt: new Date(),
                },
              }
            );
            fhirResourcesUpdated++;
          } else {
            // Insert
            await patientsCollection.updateOne(
              { _id: patient._id },
              {
                $set: {
                  fhir: fhirPatient,
                },
              }
            );
            fhirResourcesCreated++;
          }

          fhirResources.push({
            resourceType: 'Patient',
            id: fhirPatient.id,
            resource: fhirPatient,
          });
        } catch (error) {
          logger.error(`Erro ao processar FHIR para paciente ${patient._id}:`, error);
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
      logger.error('Erro no worker de pacientes:', error);
      throw error;
    }
  }
}

module.exports = new PatientWorker();

