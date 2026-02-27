/**
 * Modelo de validação e estrutura para Reports
 * Baseado no Diagrama de Classes
 */
class ReportsModel {
  static validate(data) {
    const errors = [];

    if (!data.reportType || typeof data.reportType !== 'string') {
      errors.push('reportType é obrigatório e deve ser string');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      reportID: data.reportID || null,
      reportType: data.reportType,
      reportData: data.reportData || null,
      filters: data.filters || {},
      generatedAt: data.generatedAt || new Date(),
      generatedBy: data.generatedBy || null,
      status: data.status || 'pending',
      filePath: data.filePath || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  static validateReportType(reportType) {
    const validTypes = [
      'patients',
      'samples',
      'withdrawals',
      'temperature',
      'sensors',
      'quality',
      'inventory',
      'audit'
    ];
    return validTypes.includes(reportType);
  }
}

module.exports = ReportsModel;

