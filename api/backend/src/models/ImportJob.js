/**
 * Modelo de Job de Importação
 * Representa um job na fila de processamento
 */

class ImportJob {
  constructor(data) {
    this.jobID = data.jobID || null;
    this.userID = data.userID || null;
    this.dataType = data.dataType || null; // 'patients', 'samples', 'results', 'temperature', 'temperature-iot'
    this.filePath = data.filePath || null;
    this.fileName = data.fileName || null;
    this.fileSize = data.fileSize || null;
    this.status = data.status || 'pending'; // 'pending', 'processing', 'completed', 'completed_no_data' (#890: terminal, wrote nothing -- every processed entry hit an unimplemented/unsupported format stub), 'failed', 'cancelled'
    this.progress = data.progress || 0; // 0-100
    this.totalRecords = data.totalRecords || 0;
    this.successCount = data.successCount || 0;
    this.errorCount = data.errorCount || 0;
    this.importErrors = data.importErrors || [];
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;
    this.fhirResources = data.fhirResources || []; // Recursos FHIR gerados
  }

  static create(data) {
    return new ImportJob(data);
  }

  static validate(data) {
    const errors = [];

    if (!data.dataType) {
      errors.push('Tipo de dados (dataType) é obrigatório');
    } else if (!['patients', 'samples', 'results', 'temperature', 'temperature-iot'].includes(data.dataType)) {
      errors.push('Tipo de dados inválido');
    }

    if (!data.filePath && !data.fileName) {
      errors.push('Arquivo (filePath ou fileName) é obrigatório');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  toJSON() {
    return {
      jobID: this.jobID,
      userID: this.userID,
      dataType: this.dataType,
      fileName: this.fileName,
      fileSize: this.fileSize,
      status: this.status,
      progress: this.progress,
      totalRecords: this.totalRecords,
      successCount: this.successCount,
      errorCount: this.errorCount,
      importErrors: this.importErrors,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
    };
  }
}

module.exports = ImportJob;

