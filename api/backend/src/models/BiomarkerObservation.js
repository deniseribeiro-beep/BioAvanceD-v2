class BiomarkerObservationModel {
  static VALID_TYPES = null;

  static VALID_STATUSES = ['final', 'preliminary', 'amended', 'cancelled'];

  static VALID_EVENT_TYPES = ['create', 'update', 'manual'];

  static EVENT_TYPE_ALIASES = {
    criar: 'create',
    cadastro: 'create',
    atualizar: 'update',
    atualizacao: 'update',
    atualização: 'update',
    manual: 'manual'
  };

  static normalizeDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  static normalizeUnit(input = {}) {
    const rawUnit = String(input.unit || '').trim();

    if (rawUnit) return rawUnit;
    return null;
  }

  static normalizeEventType(value) {
    const normalizedValue = String(value || 'manual').trim().toLowerCase();
    return this.EVENT_TYPE_ALIASES[normalizedValue] || normalizedValue;
  }

  static validate(data = {}) {
    const errors = [];

    const participantId = String(data.participantId || '').trim();
    if (!participantId) {
      errors.push('participantId é obrigatório');
    }

    const specimenId = String(data.specimenId || '').trim();
    if (!specimenId) {
      errors.push('specimenId é obrigatório');
    }

    const biomarkerType = String(data.biomarkerType || '').trim();
    if (!biomarkerType) {
      errors.push('biomarkerType é obrigatório');
    }

    const valueNumber = Number(data.value);
    if (!Number.isFinite(valueNumber)) {
      errors.push('value deve ser numérico');
    } else if (valueNumber < 0) {
      errors.push('value não pode ser negativo');
    }

    const collectedAt = this.normalizeDate(data.collectedAt || data.issuedAt || data.effectiveDateTime);
    if (!collectedAt) {
      errors.push('collectedAt deve ser uma data válida');
    }

    if (data.status !== undefined && data.status !== null) {
      const status = String(data.status).trim().toLowerCase();
      if (!this.VALID_STATUSES.includes(status)) {
        errors.push(`status inválido. Valores permitidos: ${this.VALID_STATUSES.join(', ')}`);
      }
    }

    if (data.eventType !== undefined && data.eventType !== null) {
      const eventType = this.normalizeEventType(data.eventType);
      if (!this.VALID_EVENT_TYPES.includes(eventType)) {
        errors.push(`eventType inválido. Valores permitidos: ${this.VALID_EVENT_TYPES.join(', ')}`);
      }
    }

    const unit = this.normalizeUnit(data);
    if (!unit) {
      errors.push('unit é obrigatório para observação biomarcadora');
    }

    const resourceType = String(data.resourceType || 'Observation').trim() || 'Observation';
    const subject = data.subject || null;
    const specimen = data.specimen || { reference: `Specimen/${specimenId}` };
    const effectiveDateTime = this.normalizeDate(data.effectiveDateTime || collectedAt);

    return {
      isValid: errors.length === 0,
      errors,
      normalized: {
        participantId,
        biomarkerType,
        value: Number.isFinite(valueNumber) ? valueNumber : null,
        unit,
        collectedAt,
        status: String(data.status || 'final').trim().toLowerCase(),
        source: String(data.source || 'patient').trim().toLowerCase(),
        eventType: this.normalizeEventType(data.eventType),
        notes: data.notes ? String(data.notes).trim() : null,
        patientObjectId: data.patientObjectId ? String(data.patientObjectId).trim() : null,
        specimenObjectId: data.specimenObjectId ? String(data.specimenObjectId).trim() : null,
        linkedResourceType: data.linkedResourceType ? String(data.linkedResourceType).trim() : 'Patient',
        linkedResourceId: data.linkedResourceId ? String(data.linkedResourceId).trim() : participantId,
        specimenId,
        resourceType,
        subject,
        specimen,
        effectiveDateTime
      }
    };
  }

  static buildIdempotencyKey(normalized = {}) {
    return [
      normalized.participantId,
      normalized.specimenId || '',
      normalized.biomarkerType,
      normalized.collectedAt?.toISOString() || '',
      normalized.value,
      normalized.eventType
    ].join('|');
  }

  static create(data = {}) {
    const validation = this.validate(data);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const normalized = validation.normalized;

    return {
      participantId: normalized.participantId,
      biomarkerType: normalized.biomarkerType,
      value: normalized.value,
      unit: normalized.unit,
      collectedAt: normalized.collectedAt,
      status: normalized.status,
      source: normalized.source,
      eventType: normalized.eventType,
      notes: normalized.notes,
      patientObjectId: normalized.patientObjectId,
      specimenObjectId: normalized.specimenObjectId,
      linkedResourceType: normalized.linkedResourceType,
      linkedResourceId: normalized.linkedResourceId,
      specimenId: normalized.specimenId,
      resourceType: normalized.resourceType,
      subject: normalized.subject,
      specimen: normalized.specimen,
      effectiveDateTime: normalized.effectiveDateTime,
      idempotencyKey: this.buildIdempotencyKey(normalized),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = BiomarkerObservationModel;
