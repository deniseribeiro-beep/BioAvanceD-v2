/**
 * Modelo de Métricas de Importação
 * Persiste histórico e estatísticas de importações
 */

class ImportMetrics {
  constructor(data) {
    this.metricsID = data.metricsID || null;
    this.jobID = data.jobID || null;
    this.userID = data.userID || null;
    this.dataType = data.dataType || null;
    this.date = data.date || new Date();
    this.totalJobs = data.totalJobs || 0;
    this.totalRecords = data.totalRecords || 0;
    this.successCount = data.successCount || 0;
    this.errorCount = data.errorCount || 0;
    this.averageProcessingTime = data.averageProcessingTime || 0; // em segundos
    this.fhirResourcesCreated = data.fhirResourcesCreated || 0;
    this.fhirResourcesUpdated = data.fhirResourcesUpdated || 0;
    this.breakdown = data.breakdown || {
      byStatus: {},
      byDataType: {},
      byHour: {},
    };
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data) {
    return new ImportMetrics(data);
  }

  static validate(data) {
    const errors = [];

    if (!data.dataType) {
      errors.push('Tipo de dados (dataType) é obrigatório');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  toJSON() {
    return {
      metricsID: this.metricsID,
      jobID: this.jobID,
      userID: this.userID,
      dataType: this.dataType,
      date: this.date,
      totalJobs: this.totalJobs,
      totalRecords: this.totalRecords,
      successCount: this.successCount,
      errorCount: this.errorCount,
      averageProcessingTime: this.averageProcessingTime,
      fhirResourcesCreated: this.fhirResourcesCreated,
      fhirResourcesUpdated: this.fhirResourcesUpdated,
      breakdown: this.breakdown,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = ImportMetrics;

