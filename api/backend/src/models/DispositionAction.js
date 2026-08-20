const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para DispositionAction (RF026 AC#3/#4/#5,
 * dict-02 ELM-0411..0415, "Retenção e destino final").
 *
 * dict-02 defines legalHold/dispositionAction/dispositionMethod/
 * dispositionDateTime/dispositionCertificateUri but has no field for
 * "responsável"/"itens afetados" (AC#4) -- `performedBy`/`affectedRecordIds`
 * below are local extensions, same precedent as Nonconformance.js's
 * `correctiveAction.responsible` (RF025). `retentionPolicyId`/`entityType`
 * are also local extensions proving AC#1's "vincular registros a
 * RetentionPolicy" concretely (dict-02 only asserts the link in prose, on
 * the `DispositionAction vinculada a RetentionPolicy` note, never as its
 * own field) -- see this repo's #664-style referential-integrity
 * discipline: `retentionPolicyId` here is checked against a real
 * RetentionPolicy document, not just format-validated.
 */
const DISPOSITION_ACTIONS = ['transfer', 'return', 'destroy', 'anonymize', 'preserve'];

class DispositionActionModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.retentionPolicyId || typeof data.retentionPolicyId !== 'string' || data.retentionPolicyId.trim() === '') {
      errors.push('retentionPolicyId é obrigatório');
    }

    if (!data.entityType || typeof data.entityType !== 'string' || data.entityType.trim() === '') {
      errors.push('entityType é obrigatório');
    }

    if (!Array.isArray(data.affectedRecordIds) || data.affectedRecordIds.length === 0) {
      errors.push('affectedRecordIds é obrigatório e deve ser um array não vazio');
    } else if (data.affectedRecordIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
      errors.push('affectedRecordIds deve conter apenas strings não vazias');
    }

    if (!data.dispositionAction || !DISPOSITION_ACTIONS.includes(data.dispositionAction)) {
      errors.push(`dispositionAction é obrigatório e deve ser um de: ${DISPOSITION_ACTIONS.join(', ')}`);
    }

    if (!data.performedBy || typeof data.performedBy !== 'string' || data.performedBy.trim() === '') {
      errors.push('performedBy é obrigatório');
    }

    if (data.dispositionMethod !== undefined && data.dispositionMethod !== null && typeof data.dispositionMethod !== 'string') {
      errors.push('dispositionMethod deve ser string');
    }

    if (data.dispositionCertificateUri !== undefined && data.dispositionCertificateUri !== null && typeof data.dispositionCertificateUri !== 'string') {
      errors.push('dispositionCertificateUri deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const dispositionActionId = randomUUID();
    return {
      dispositionActionId,
      retentionPolicyId: data.retentionPolicyId,
      entityType: data.entityType,
      affectedRecordIds: [...data.affectedRecordIds],
      dispositionAction: data.dispositionAction,
      dispositionMethod: data.dispositionMethod || null,
      performedBy: data.performedBy,
      dispositionDateTime: new Date(),
      // AC#5: no real document-generation/object-storage capability exists
      // in this repo to build a real PDF/certificate against honestly (see
      // #666-style "don't fabricate infrastructure" discipline) -- the
      // persisted DispositionAction record itself, reachable at a stable
      // certificate sub-resource, IS the durable evidence dict-02 asks for.
      dispositionCertificateUri: data.dispositionCertificateUri || `/api/disposition-actions/${dispositionActionId}/certificate`,
      legalHold: !!data.legalHold,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = DispositionActionModel;
module.exports.DISPOSITION_ACTIONS = DISPOSITION_ACTIONS;
