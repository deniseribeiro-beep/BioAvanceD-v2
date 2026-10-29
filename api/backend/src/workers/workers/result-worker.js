const fhirService = require('../../services/fhir.service');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const csv = require('csv-parser');

/**
 * Worker de Importacao de Arquivos de Analise
 * Processa importacao de arquivos de analise (ZIP/RAW/CSV) com suporte FHIR
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
      unprocessedFormats: 0,
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
        await this.processZip(db, jobID, filePath, results, fhirResources);
      } else if (ext === '.raw') {
        // Processa arquivo RAW
        await this.processRaw(db, filePath, results, fhirResources);
      } else if (ext === '.csv') {
        // Processa arquivo CSV
        await this.processCSV(db, jobID, filePath, results, fhirResources);
      } else {
        throw new Error(`Formato de arquivo não suportado: ${ext}`);
      }

      const processingTime = (Date.now() - startTime) / 1000;

      return {
        total: results.total,
        success: results.success,
        errors: results.errors,
        unprocessedFormats: results.unprocessedFormats,
        processingTime,
        fhirResourcesCreated,
        fhirResourcesUpdated,
        fhirResources,
      };
    } catch (error) {
      logger.error('Erro no worker de arquivos de analise:', error);
      throw error;
    }
  }

  /**
   * Processa arquivo ZIP
   */
  async processZip(db, jobID, filePath, results, fhirResources) {
    return new Promise((resolve, reject) => {
      // validateEntrySizes: false — some zip writers (e.g. streamed
      // archives using data descriptors) report an uncompressedSize of 0
      // in the central directory even though the entry has real content;
      // yauzl's AssertByteCountStream then throws "too many bytes in the
      // stream" while decompressing perfectly valid data.
      yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: false }, (err, zipfile) => {
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
              let entryHandled = false;

              const finishEntry = (errorMessage) => {
                if (entryHandled) {
                  return;
                }
                entryHandled = true;

                results.errors.push({ error: errorMessage });

                try {
                  if (!writeStream.destroyed) {
                    writeStream.destroy();
                  }
                } catch (streamError) {
                  logger.warn(`Falha ao encerrar stream temporário de ${entry.fileName}: ${streamError.message}`);
                }

                try {
                  if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                  }
                } catch (cleanupError) {
                  logger.warn(`Falha ao remover arquivo temporário ${tempPath}: ${cleanupError.message}`);
                }

                zipfile.readEntry();
              };

              readStream.on('error', (streamError) => {
                finishEntry(`Erro ao ler ${entry.fileName}: ${streamError.message}`);
              });
              writeStream.on('error', (streamError) => {
                finishEntry(`Erro ao gravar ${entry.fileName}: ${streamError.message}`);
              });
              readStream.pipe(writeStream);
              writeStream.on('close', async () => {
                if (entryHandled) {
                  return;
                }
                entryHandled = true;
                try {
                  await this.processFile(db, jobID, tempPath, results, fhirResources);
                } catch (error) {
                  results.errors.push({
                    error: `Erro ao processar ${entry.fileName}: ${error.message}`,
                  });
                }
                try {
                  fs.unlinkSync(tempPath); // Remove arquivo temporário
                } catch (cleanupError) {
                  logger.warn(`Falha ao remover arquivo temporário ${tempPath}: ${cleanupError.message}`);
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
  async processCSV(db, jobID, filePath, results, fhirResources) {
    return new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(filePath)
        .on('error', reject)
        .pipe(csv())
        .on('data', (row) => {
          rows.push(row);
        })
        .on('end', async () => {
          try {
            for (const row of rows) {
              await this.processResultRow(db, jobID, row, results, fhirResources);
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
  async processFile(db, jobID, filePath, results, fhirResources) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv') {
      await this.processCSV(db, jobID, filePath, results, fhirResources);
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
  async processResultRow(db, jobID, row, results, fhirResources) {
    results.total++;

    try {
      // Valida campos obrigatórios
      if (!row.specimenId && !row.barcode) {
        throw new Error('specimenId ou barcode é obrigatório');
      }

      // Busca amostra
      // #1340: query only the identifiers the row carries. A row with no
      // barcode column has row.barcode undefined, which the driver sends as
      // { barcode: null }, and that matches every sample without a barcode:
      // the result was attached to whichever such sample came first.
      const identifierClauses = [];
      if (row.specimenId) identifierClauses.push({ specimenId: row.specimenId });
      if (row.barcode) identifierClauses.push({ barcode: row.barcode });
      const samplesCollection = getCollection(db, 'samples');
      const sample = await samplesCollection.findOne({ $or: identifierClauses });

      if (!sample) {
        throw new Error(
          `Amostra não encontrada: ${row.specimenId || row.barcode}`
        );
      }

      // Cria resultado
      // #628: specimenId must be the Specimen's own canonical business
      // identifier -- never a Mongo _id fallback, which would reintroduce
      // the exact stored-shape inconsistency this field's dedicated fix
      // exists to remove.
      const resultData = {
        specimenId: sample.specimenId,
        testName: row.testName || row.test || 'Unknown Test',
        testCode: row.testCode || row.code || 'UNKNOWN',
        resultValue: row.resultValue || row.value || null,
        testDate: row.testDate ? new Date(row.testDate) : new Date(),
        filePath: row.filePath || null,
        fileType: row.fileType || 'CSV',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // #861: absent/undefined jobID (e.g. a result created outside an
      // import job) must not write a junk importJobID field.
      if (jobID) {
        resultData.importJobID = jobID;
      }

      const resultsCollection = db.collection('results');
      const result = await resultsCollection.insertOne(resultData);

      // Converte para FHIR
      const sampleReference = {
        reference: `Specimen/${sample.specimenId || sample._id}`,
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
      code: 'FORMAT_NOT_IMPLEMENTED',
      error: 'Processamento de arquivo RAW ainda não totalmente implementado',
      fileName,
    });
    results.unprocessedFormats += 1;
  }

  /**
   * Processa arquivo genérico
   */
  async processGenericFile(db, filePath, results, fhirResources) {
    // Implementação básica - pode ser expandida conforme necessário
    results.total++;
    results.errors.push({
      code: 'FORMAT_UNSUPPORTED',
      error: 'Formato de arquivo não suportado',
      filePath,
    });
    results.unprocessedFormats += 1;
  }
}

module.exports = new ResultWorker();

