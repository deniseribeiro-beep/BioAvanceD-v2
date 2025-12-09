const fhirService = require('../../services/fhir.service');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const csv = require('csv-parser');

/**
 * Worker de Importação de Resultados
 * Processa importação de resultados (ZIP/RAW/CSV) com suporte FHIR
 */

class ResultWorker {
  async process(db, jobID, filePath, options = {}) {
    const startTime = Date.now();
    let fhirResourcesCreated = 0;
    let fhirResourcesUpdated = 0;
    const fhirResources = [];
    const results = {
      total: 0,
      success: 0,
      errors: [],
    };

    try {
      // Verifica se arquivo existe
      if (!fs.existsSync(filePath)) {
        throw new Error(`Arquivo não encontrado: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();
      const resultsCollection = db.collection('results');

      if (ext === '.zip') {
        // Processa arquivo ZIP
        await this.processZip(db, filePath, results, fhirResources);
      } else if (ext === '.raw') {
        // Processa arquivo RAW
        await this.processRaw(db, filePath, results, fhirResources);
      } else if (ext === '.csv') {
        // Processa arquivo CSV
        await this.processCSV(db, filePath, results, fhirResources);
      } else {
        throw new Error(`Formato de arquivo não suportado: ${ext}`);
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
      logger.error('Erro no worker de resultados:', error);
      throw error;
    }
  }

  /**
   * Processa arquivo ZIP
   */
  async processZip(db, filePath, results, fhirResources) {
    return new Promise((resolve, reject) => {
      yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          return reject(err);
        }

        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // É um diretório, pula
            zipfile.readEntry();
          } else {
            // É um arquivo, extrai e processa
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                results.errors.push({
                  error: `Erro ao extrair ${entry.fileName}: ${err.message}`,
                });
                zipfile.readEntry();
                return;
              }

              // Processa arquivo extraído
              const tempPath = path.join(
                path.dirname(filePath),
                `temp_${Date.now()}_${entry.fileName}`
              );
              const writeStream = fs.createWriteStream(tempPath);

              readStream.pipe(writeStream);
              writeStream.on('close', async () => {
                try {
                  await this.processFile(db, tempPath, results, fhirResources);
                  fs.unlinkSync(tempPath); // Remove arquivo temporário
                } catch (error) {
                  results.errors.push({
                    error: `Erro ao processar ${entry.fileName}: ${error.message}`,
                  });
                }
                zipfile.readEntry();
              });
            });
          }
        });

        zipfile.on('end', () => {
          resolve();
        });

        zipfile.on('error', (err) => {
          reject(err);
        });
      });
    });
  }

  /**
   * Processa arquivo RAW
   */
  async processRaw(db, filePath, results, fhirResources) {
    // Lê arquivo RAW como binário e processa
    const buffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    // Tenta extrair informações do arquivo RAW
    // Assumindo que contém metadados no nome ou estrutura conhecida
    await this.processRawFile(db, buffer, fileName, results, fhirResources);
  }

  /**
   * Processa arquivo CSV
   */
  async processCSV(db, filePath, results, fhirResources) {
    return new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', async () => {
          try {
            for (const row of rows) {
              await this.processResultRow(db, row, results, fhirResources);
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Processa arquivo genérico
   */
  async processFile(db, filePath, results, fhirResources) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') {
      await this.processCSV(db, filePath, results, fhirResources);
    } else if (ext === '.raw') {
      await this.processRaw(db, filePath, results, fhirResources);
    } else {
      // Tenta processar como arquivo genérico
      await this.processGenericFile(db, filePath, results, fhirResources);
    }
  }

  /**
   * Processa linha de resultado do CSV
   */
  async processResultRow(db, row, results, fhirResources) {
    results.total++;

    try {
      // Valida campos obrigatórios
      if (!row.sampleID && !row.sampleId && !row.barcode) {
        throw new Error('sampleID, sampleId ou barcode é obrigatório');
      }

      // Busca amostra
      const samplesCollection = db.collection('amostras');
      const sample = await samplesCollection.findOne({
        $or: [
          { sampleID: row.sampleID || row.sampleId },
          { barcode: row.barcode },
        ],
      });

      if (!sample) {
        throw new Error(
          `Amostra não encontrada: ${row.sampleID || row.sampleId || row.barcode}`
        );
      }

      // Cria resultado
      const resultData = {
        sampleID: sample.sampleID || sample._id,
        testName: row.testName || row.test || 'Unknown Test',
        testCode: row.testCode || row.code || 'UNKNOWN',
        resultValue: row.resultValue || row.value || null,
        testDate: row.testDate ? new Date(row.testDate) : new Date(),
        filePath: row.filePath || null,
        fileType: row.fileType || 'CSV',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const resultsCollection = db.collection('results');
      const result = await resultsCollection.insertOne(resultData);

      // Converte para FHIR
      const sampleReference = {
        reference: `Specimen/${sample.sampleID || sample._id}`,
      };

      const fhirResult = fhirService.resultToFHIR(
        { ...resultData, _id: result.insertedId },
        sampleReference
      );

      // Salva FHIR
      await resultsCollection.updateOne(
        { _id: result.insertedId },
        {
          $set: {
            fhir: fhirResult.observation,
            fhirDiagnosticReport: fhirResult.diagnosticReport,
          },
        }
      );

      fhirResources.push({
        resourceType: 'Observation',
        id: fhirResult.observation.id,
        resource: fhirResult.observation,
      });

      fhirResources.push({
        resourceType: 'DiagnosticReport',
        id: fhirResult.diagnosticReport.id,
        resource: fhirResult.diagnosticReport,
      });

      results.success++;
    } catch (error) {
      results.errors.push({
        row: results.total,
        error: error.message,
      });
    }
  }

  /**
   * Processa arquivo RAW genérico
   */
  async processRawFile(db, buffer, fileName, results, fhirResources) {
    // Implementação básica - pode ser expandida conforme necessário
    results.total++;
    results.errors.push({
      error: 'Processamento de arquivo RAW ainda não totalmente implementado',
      fileName,
    });
  }

  /**
   * Processa arquivo genérico
   */
  async processGenericFile(db, filePath, results, fhirResources) {
    // Implementação básica - pode ser expandida conforme necessário
    results.total++;
    results.errors.push({
      error: 'Formato de arquivo não suportado',
      filePath,
    });
  }
}

module.exports = new ResultWorker();

