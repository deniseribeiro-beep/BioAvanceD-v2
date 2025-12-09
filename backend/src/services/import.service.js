const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const PatientModel = require('../models/Patient');
const SampleModel = require('../models/Sample');
const TemperatureModel = require('../models/Temperature');

/**
 * Service de Importação de Dados
 * RF007 - Upload e Importação de Dados
 * Suporta: Pacientes (CSV/JSON), Amostras (CSV/JSON), Resultados (ZIP/RAW/CSV), Temperatura (CSV/Streaming)
 */
class ImportService {
  /**
   * Valida formato do arquivo
   */
  validateFileFormat(file, allowedTypes) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;

    const validExtensions = {
      'patients': ['.csv', '.json'],
      'samples': ['.csv', '.json'],
      'results': ['.zip', '.raw', '.csv'],
      'temperature': ['.csv']
    };

    const validMimeTypes = {
      'patients': ['text/csv', 'application/json'],
      'samples': ['text/csv', 'application/json'],
      'results': ['application/zip', 'application/octet-stream', 'text/csv'],
      'temperature': ['text/csv']
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
      'results': ['sampleID', 'fileType', 'filePath']
    };
    return fields[dataType] || [];
  }

  /**
   * Processa importação de pacientes
   */
  async importPatients(db, file) {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const patientsCollection = db.collection('pacientes');
      const results = { success: 0, errors: [], total: 0 };

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

            const patient = PatientModel.create(patientData);
            await patientsCollection.insertOne(patient);
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
            // Converte tipos do CSV
            const patientData = this.parsePatientCSV(row);
            const validation = PatientModel.validate(patientData);
            
            if (!validation.isValid) {
              results.errors.push({
                row: results.total + 1,
                errors: validation.errors
              });
              continue;
            }

            const patient = PatientModel.create(patientData);
            await patientsCollection.insertOne(patient);
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
      const samplesCollection = db.collection('amostras');
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
            const sampleData = this.parseSampleCSV(row);
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
      }

      return results;
    } catch (error) {
      logger.error('Erro ao importar amostras:', error.message);
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
    return {
      patientID: parseInt(row.patientID),
      sampleType: row.sampleType,
      sampleOrigin: row.sampleOrigin,
      extractionProtocol: row.extractionProtocol || null,
      barcode: row.barcode ? parseInt(row.barcode) : null,
      registrationDate: row.registerDate ? new Date(row.registerDate) : new Date(),
      quantity: row.quantity ? parseFloat(row.quantity) : null,
      quality: row.quality ? parseInt(row.quality) : null,
      locationID: row.locationID ? parseInt(row.locationID) : null,
      linkedProject: row.linkedProject || null,
      currentStatus: row.currentStatus || 'Available'
    };
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

