const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const PatientModel = require('../models/Patient');
const SampleModel = require('../models/Sample');
const TemperatureModel = require('../models/Temperature');
const LocationModel = require('../models/Location');
const fhirValidator = require('./fhir-validator.service');
const notificationService = require('./notification.service');
const { getCollection } = require('../utils/collectionResolver');

/**
 * Service de Importação de Dados
 * RF007 - Upload e Importação de Dados
 * Suporta: Pacientes (CSV/JSON), Amostras (CSV/JSON), Arquivos de Analise (ZIP/RAW/CSV), Temperatura (CSV/Streaming)
 */
class ImportService {
  /**
   * Valida formato do arquivo
   */
  validateFileFormat(file, allowedTypes) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;

    const validExtensions = {
      'patients': ['.csv', '.json', '.xlsx'],
      'samples': ['.csv', '.json', '.xlsx'],
      'results': ['.zip', '.raw', '.csv', '.xlsx'],
      'temperature': ['.csv'],
      'locations': ['.csv', '.json']
    };

    const validMimeTypes = {
      'patients': ['text/csv', 'application/json', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'samples': ['text/csv', 'application/json', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'results': ['application/zip', 'application/octet-stream', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      'temperature': ['text/csv'],
      'locations': ['text/csv', 'application/json']
    };

    const extensions = validExtensions[allowedTypes] || [];
    const mimeTypes = validMimeTypes[allowedTypes] || [];

    return extensions.includes(ext) || mimeTypes.includes(mimeType);
  }

  /**
   * Valida estrutura do arquivo CSV
   */
  async validateCSVStructure(file, dataType) {
    return new Promise((resolve, reject) => {
      const errors = [];
      const requiredFields = this.getRequiredFields(dataType);
      const rows = [];
      let headerRow = null;

      const stream = fs.createReadStream(file.path)
        .pipe(csv())
        .on('headers', (headers) => {
          headerRow = headers;
          const missingFields = requiredFields.filter(field => !headers.includes(field));
          if (missingFields.length > 0) {
            errors.push(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
          }
        })
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', () => {
          if (errors.length > 0) {
            return reject(new Error(errors.join('; ')));
          }
          resolve({ valid: true, rowCount: rows.length, headers: headerRow });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Retorna campos obrigatórios por tipo de dados
   */
  getRequiredFields(dataType) {
    const fields = {
      'patients': ['patientName', 'birthDate', 'sex'],
      'samples': ['patientID', 'sampleType', 'sampleOrigin'],
      'temperature': ['sensorId', 'temperatureValue', 'timestamp'],
      'results': ['sampleID', 'fileType', 'filePath'],
      'locations': ['equipmentType', 'block', 'rack', 'drawer', 'box']
    };
    return fields[dataType] || [];
  }

  /**
   * Valida arquivo JSON como FHIR R4 (Patient/Specimen/Observation/Organization)
   */
  validateFHIRFile(file) {
    try {
      const raw = fs.readFileSync(file.path, 'utf8');
      const payload = JSON.parse(raw);

      if (!fhirValidator.isFhirResource(payload)) {
        return { isFhir: false, valid: true };
      }

      const result = fhirValidator.validatePayload(payload, ['Patient', 'Specimen', 'Observation', 'Organization', 'Bundle']);
      const operationOutcome = fhirValidator.buildOperationOutcome(result.issues || []);

      return {
        isFhir: true,
        valid: result.valid,
        issues: result.issues || [],
        resourcesValidated: result.resourcesValidated || 0,
        operationOutcome
      };
    } catch (error) {
      return {
        isFhir: false,
        valid: false,
        issues: [{
          severity: 'error',
          code: 'invalid',
          diagnostics: error.message || 'Arquivo JSON inválido',
          expression: '/'
        }],
        resourcesValidated: 0,
        operationOutcome: fhirValidator.buildOperationOutcome([
          { severity: 'error', code: 'invalid', diagnostics: error.message || 'Arquivo JSON inválido', expression: '/' }
        ])
      };
    }
  }

  /**
   * Processa importação de pacientes
   */
  async importPatients(db, file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const patientsCollection = await getCollection(db, 'patients');
      const results = { success: 0, errors: [], total: 0 };

      // Função de merge inteligente
      function mergePatientData(existing, incoming) {
        const merged = { ...existing };
        for (const key of Object.keys(incoming)) {
          // Nunca sobrescrever campos existentes com nulo/vazio
          if (
            incoming[key] !== undefined &&
            incoming[key] !== null &&
            !(typeof incoming[key] === 'string' && incoming[key].trim() === '')
          ) {
            // Não permite mudar birthDate
            if (key === 'birthDate' && existing.birthDate && incoming.birthDate && String(existing.birthDate) !== String(incoming.birthDate)) {
              throw new Error('Data de nascimento não pode ser alterada para paciente já existente.');
            }
            // Para arrays (ex: samples), faz append
            if (Array.isArray(existing[key]) && Array.isArray(incoming[key])) {
              merged[key] = [...existing[key], ...incoming[key]];
            } else if (typeof incoming[key] === 'object' && typeof existing[key] === 'object' && incoming[key] && existing[key]) {
              merged[key] = { ...existing[key], ...incoming[key] };
            } else {
              merged[key] = incoming[key];
            }
          }
        }
        return merged;
      }

      async function upsertPatient(patientData) {
        // Identificador único: CPF OU recordNumber
        const query = {};
        if (patientData.cpf) query.cpf = patientData.cpf;
        else if (patientData.recordNumber) query.recordNumber = patientData.recordNumber;
        else return { action: 'skip', reason: 'Sem identificador único (CPF ou Prontuário)' };

        const existing = await patientsCollection.findOne(query);
        if (!existing) {
          // Novo cadastro
          const consentMetadata = notificationService.buildConsentMetadata();
          patientData.status = 'PENDING_CONSENT';
          patientData.consentToken = consentMetadata.token;
          patientData.consentTokenCreatedAt = consentMetadata.createdAt;
          patientData.consentTokenExpiresAt = consentMetadata.expiresAt;
          const patient = PatientModel.create(patientData);
          const insertResult = await patientsCollection.insertOne(patient);
          if (patient.patientID) {
            try {
              const consentLink = notificationService.buildConsentLink(patient, consentMetadata.token);
              await notificationService.enqueueConsentNotification(patientData, consentLink);
              await patientsCollection.updateOne(
                { _id: insertResult.insertedId },
                { $set: { consentNotifiedAt: new Date() } }
              );
            } catch (notifyError) {
              logger.error('Erro ao enfileirar notificações de consentimento (importação):', notifyError.message);
            }
          }
          return { action: 'new' };
        } else {
          // Merge inteligente
          let merged;
          try {
            merged = mergePatientData(existing, patientData);
          } catch (mergeError) {
            return { action: 'error', error: mergeError.message };
          }
          merged.updatedAt = new Date();
          await patientsCollection.updateOne({ _id: existing._id }, { $set: merged });
          return { action: 'merge' };
        }
      }

      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        const patients = Array.isArray(data) ? data : [data];

        for (const patientData of patients) {
          try {
            const validation = PatientModel.validate(patientData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              continue;
            }
            const upsertResult = await upsertPatient(patientData);
            if (upsertResult.action === 'error') {
              results.errors.push({
                row: results.total + 1,
                error: upsertResult.error
              });
            } else if (upsertResult.action === 'skip') {
              results.errors.push({
                row: results.total + 1,
                error: upsertResult.reason
              });
            } else {
              results.success++;
            }
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      } else if (ext === '.csv') {
        const rows = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(file.path)
            .pipe(csv())
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
        });

        for (const row of rows) {
          try {
            const patientData = this.parsePatientCSV(row);
            const validation = PatientModel.validate(patientData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              continue;
            }
            const upsertResult = await upsertPatient(patientData);
            if (upsertResult.action === 'error') {
              results.errors.push({
                row: results.total + 1,
                error: upsertResult.error
              });
            } else if (upsertResult.action === 'skip') {
              results.errors.push({
                row: results.total + 1,
                error: upsertResult.reason
              });
            } else {
              results.success++;
            }
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar pacientes:', error.message);
      throw error;
    }
  }

  /**
   * Processa importação de amostras
   */
  async importSamples(db, file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const samplesCollection = await getCollection(db, 'samples');
      const results = { success: 0, errors: [], total: 0 };

      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        const samples = Array.isArray(data) ? data : [data];

        for (const sampleData of samples) {
          try {
            const validation = SampleModel.validate(sampleData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              continue;
            }

            const sample = SampleModel.create(sampleData);
            await samplesCollection.insertOne(sample);
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      } else if (ext === '.csv') {
        // Valida cabecalhos antes de processar o arquivo inteiro
        try {
          await this.validateCSVStructure(file, 'samples');
        } catch (structError) {
          results.errors.push({ row: 0, error: structError.message });
          return results;
        }

        const rows = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(file.path)
            .pipe(csv())
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
        });

        for (const row of rows) {
          try {
            const { data: sampleData, parseErrors } = this.parseSampleCSV(row);

            if (parseErrors.length > 0) {
              results.errors.push({
                row: results.total + 1,
                errors: parseErrors
              });
              results.total++;
              continue;
            }

            const validation = SampleModel.validate(sampleData);
            
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              results.total++;
              continue;
            }

            const sample = SampleModel.create(sampleData);
            await samplesCollection.insertOne(sample);
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar amostras:', error.message);
      throw error;
    }
  }

  /**
   * Processa importação de localizações
   */
  async importLocations(db, file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const locationsCollection = db.collection('locations');
      const results = { success: 0, errors: [], total: 0 };

      if (ext === '.json') {
        const data = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        const locations = Array.isArray(data) ? data : [data];

        for (const locationDataRaw of locations) {
          try {
            const { data: locationData, parseErrors } = this.parseLocationData(locationDataRaw);

            if (parseErrors.length > 0) {
              results.errors.push({
                row: results.total + 1,
                errors: parseErrors
              });
              results.total++;
              continue;
            }

            const validation = LocationModel.validate(locationData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              results.total++;
              continue;
            }

            if (locationData.locationID !== undefined && locationData.locationID !== null) {
              const existing = await locationsCollection.findOne({ locationID: Number(locationData.locationID) });
              if (existing) {
                results.errors.push({
                  row: results.total + 1,
                  errors: [`locationID ${locationData.locationID} já existe`]
                });
                results.total++;
                continue;
              }
            } else {
              const { generateUniqueLocationID } = require('../utils/locationIDGenerator');
              locationData.locationID = await generateUniqueLocationID(db, 'locations');
            }

            const location = LocationModel.create(locationData);
            await locationsCollection.insertOne(location);
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      } else if (ext === '.csv') {
        try {
          await this.validateCSVStructure(file, 'locations');
        } catch (structError) {
          results.errors.push({ row: 0, error: structError.message });
          return results;
        }

        const rows = [];
        await new Promise((resolve, reject) => {
          fs.createReadStream(file.path)
            .pipe(csv())
            .on('data', (row) => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
        });

        for (const row of rows) {
          try {
            const { data: locationData, parseErrors } = this.parseLocationCSV(row);

            if (parseErrors.length > 0) {
              results.errors.push({
                row: results.total + 1,
                errors: parseErrors
              });
              results.total++;
              continue;
            }

            const validation = LocationModel.validate(locationData);
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              results.total++;
              continue;
            }

            if (locationData.locationID !== undefined && locationData.locationID !== null) {
              const existing = await locationsCollection.findOne({ locationID: Number(locationData.locationID) });
              if (existing) {
                results.errors.push({
                  row: results.total + 1,
                  errors: [`locationID ${locationData.locationID} já existe`]
                });
                results.total++;
                continue;
              }
            } else {
              const { generateUniqueLocationID } = require('../utils/locationIDGenerator');
              locationData.locationID = await generateUniqueLocationID(db, 'locations');
            }

            const location = LocationModel.create(locationData);
            await locationsCollection.insertOne(location);
            results.success++;
          } catch (error) {
            results.errors.push({
              row: results.total + 1,
              error: error.message
            });
          }
          results.total++;
        }
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar localizações:', error.message);
      throw error;
    }
  }

  /**
   * Processa importação de temperatura
   */
  async importTemperature(db, file) {
    try {
      const temperaturesCollection = db.collection('temperatures');
      const results = { success: 0, errors: [], total: 0 };

      const rows = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(file.path)
          .pipe(csv())
          .on('data', (row) => rows.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      for (const row of rows) {
        try {
          const tempData = this.parseTemperatureCSV(row);
          const validation = TemperatureModel.validate(tempData);
          
          if (!validation.isValid) {
            results.errors.push({
              row: results.total + 1,
              errors: validation.errors
            });
            continue;
          }

          const temperature = TemperatureModel.create(tempData);
          await temperaturesCollection.insertOne(temperature);
          results.success++;
        } catch (error) {
          results.errors.push({
            row: results.total + 1,
            error: error.message
          });
        }
        results.total++;
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar temperatura:', error.message);
      throw error;
    }
  }

  /**
   * Parse CSV para Patient
   */
  parsePatientCSV(row) {
    return {
      patientName: row.patientName,
      birthDate: new Date(row.birthDate),
      sex: row.sex,
      weight: row.weight ? parseFloat(row.weight) : null,
      heightCm: row.heightCm ? parseFloat(row.heightCm) : null,
      recordNumber: row.recordNumber ? parseInt(row.recordNumber) : null,
      clinicalUnit: row.clinicalUnit || null,
      diagnosticHypothesis: row.diagnosticHypothesis || null,
      icdCode: row.icdCode || null,
      hypertension: row.hypertension === 'true' || row.hypertension === '1',
      obesity: row.obesity === 'true' || row.obesity === '1',
      diabetesType1: row.diabetesType1 === 'true' || row.diabetesType1 === '1',
      diabetesType2: row.diabetesType2 === 'true' || row.diabetesType2 === '1',
      copd: row.copd === 'true' || row.copd === '1',
      ckd: row.ckd === 'true' || row.ckd === '1',
      smoking: row.smoking === 'true' || row.smoking === '1',
      alcoholUse: row.alcoholUse === 'true' || row.alcoholUse === '1',
      asthma: row.asthma === 'true' || row.asthma === '1',
      antibioticUse: row.antibioticUse === 'true' || row.antibioticUse === '1',
      insulinUse: row.insulinUse === 'true' || row.insulinUse === '1',
      antiviralUse: row.antiviralUse === 'true' || row.antiviralUse === '1',
      geneticVariant: row.geneticVariant || null,
      alphaGal: row.alphaGal ? parseFloat(row.alphaGal) : null,
      lysoGb3: row.lysoGb3 ? parseFloat(row.lysoGb3) : null,
      notes: row.notes || null
    };
  }

  /**
   * Parse CSV para Sample
   */
  parseSampleCSV(row) {
    const parseErrors = [];

    const normalizeString = (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    };

    const toInt = (value, fieldName) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = parseInt(String(value).trim(), 10);
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${fieldName} inválido`);
        return null;
      }
      return parsed;
    };

    const toFloat = (value, fieldName) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = parseFloat(String(value).trim());
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${fieldName} inválido`);
        return null;
      }
      return parsed;
    };

    const toDate = (value, fieldName) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        parseErrors.push(`${fieldName} em formato inválido`);
        return null;
      }
      return parsed;
    };

    const sampleData = {
      patientID: toInt(row.patientID, 'patientID'),
      sampleType: normalizeString(row.sampleType),
      sampleOrigin: normalizeString(row.sampleOrigin),
      extractionProtocol: normalizeString(row.extractionProtocol),
      barcode: toInt(row.barcode, 'barcode'),
      registrationDate: toDate(row.registerDate, 'registerDate') || new Date(),
      quantity: toFloat(row.quantity, 'quantity'),
      quality: toInt(row.quality, 'quality'),
      locationID: toInt(row.locationID, 'locationID'),
      linkedProject: normalizeString(row.linkedProject),
      currentStatus: normalizeString(row.currentStatus) || 'Available'
    };

    return { data: sampleData, parseErrors };
  }

  /**
   * Parse CSV/JSON para Location
   */
  parseLocationData(data) {
    const parseErrors = [];

    const toNumber = (value, fieldName) => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = Number(String(value).trim());
      if (Number.isNaN(parsed)) {
        parseErrors.push(`${fieldName} inválido`);
        return null;
      }
      return parsed;
    };

    const locationData = {
      locationID: toNumber(data.locationID, 'locationID'),
      equipmentType: toNumber(data.equipmentType, 'equipmentType'),
      equipmentID: toNumber(data.equipmentID, 'equipmentID'),
      block: toNumber(data.block, 'block'),
      rack: toNumber(data.rack, 'rack'),
      drawer: toNumber(data.drawer, 'drawer'),
      box: toNumber(data.box, 'box'),
      wellPosition: data.wellPosition || data.eppendorfWell || null
    };

    return { data: locationData, parseErrors };
  }

  parseLocationCSV(row) {
    return this.parseLocationData(row);
  }

  /**
   * Parse CSV para Temperature
   */
  parseTemperatureCSV(row) {
    return {
      sensorId: row.sensorId || row.sensorID,
      temperatureValue: parseFloat(row.temperatureValue),
      temperatureUnit: row.temperatureUnit || '°C',
      timestamp: row.timestamp ? new Date(row.timestamp) : new Date(),
      readingStatus: row.readingStatus || 'valid',
      sensorStatus: row.sensorStatus || 'normal',
      signalQuality: row.signalQuality || null,
      batteryLevel: row.batteryLevel ? parseInt(row.batteryLevel) : null,
      locationId: row.locationId || row.locationID || null,
      facility: row.facility || null,
      zone: row.zone || null
    };
  }

  /**
   * Limpa arquivo temporário
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error('Erro ao limpar arquivo temporário:', error.message);
    }
  }
}

module.exports = new ImportService();

