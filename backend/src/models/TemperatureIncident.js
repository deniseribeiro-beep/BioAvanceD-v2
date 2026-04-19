/**
 * Modelo para gerenciar incidentes de temperatura
 * Persistência de incidentes com histórico de resoluções
 */
class TemperatureIncidentModel {
  static validate(data) {
    const errors = [];

    if (!data.sensorKey || typeof data.sensorKey !== 'string') {
      errors.push('sensorKey é obrigatório e deve ser string');
    }

    if (!data.sensorName || typeof data.sensorName !== 'string') {
      errors.push('sensorName é obrigatório e deve ser string');
    }

    if (!data.openedAt || isNaN(new Date(data.openedAt))) {
      errors.push('openedAt é obrigatório e deve ser uma data válida');
    }

    if (data.closedAt && isNaN(new Date(data.closedAt))) {
      errors.push('closedAt deve ser uma data válida');
    }

    if (typeof data.currentTemperature !== 'number' || !Number.isFinite(data.currentTemperature)) {
      errors.push('currentTemperature é obrigatório e deve ser um número');
    }

    if (typeof data.maxTemperature !== 'number' || !Number.isFinite(data.maxTemperature)) {
      errors.push('maxTemperature é obrigatório e deve ser um número');
    }

    if (typeof data.minTemperature !== 'number' || !Number.isFinite(data.minTemperature)) {
      errors.push('minTemperature é obrigatório e deve ser um número');
    }

    if (typeof data.samplesOutOfRange !== 'number' || data.samplesOutOfRange < 0) {
      errors.push('samplesOutOfRange deve ser um número não-negativo');
    }

    const validStatuses = ['open', 'acknowledged', 'escalated', 'resolved'];
    if (data.status && !validStatuses.includes(data.status)) {
      errors.push(`status deve ser: ${validStatuses.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    const now = new Date();
    return {
      sensorKey: String(data.sensorKey).trim(),
      sensorName: String(data.sensorName).trim(),
      openedAt: new Date(data.openedAt),
      closedAt: data.closedAt ? new Date(data.closedAt) : null,
      acknowledgedAt: data.acknowledgedAt ? new Date(data.acknowledgedAt) : null,
      acknowledgedBy: data.acknowledgedBy || null, // userId
      currentTemperature: Number(data.currentTemperature),
      maxTemperature: Number(data.maxTemperature),
      minTemperature: Number(data.minTemperature),
      samplesOutOfRange: Number(data.samplesOutOfRange),
      status: data.status || 'open', // open, acknowledged, escalated, resolved
      notes: data.notes || [],
      escalationLevel: data.escalationLevel || 0, // 0: notificado, 1: supervisor, 2: crítico
      lastEscalatedAt: data.lastEscalatedAt ? new Date(data.lastEscalatedAt) : null,
      emailsSent: data.emailsSent || [],
      createdAt: now,
      updatedAt: now
    };
  }

  static statusLabel(status) {
    const labels = {
      'open': 'Aberto',
      'acknowledged': 'Reconhecido',
      'escalated': 'Escalado',
      'resolved': 'Resolvido'
    };
    return labels[status] || status;
  }
}

module.exports = TemperatureIncidentModel;
