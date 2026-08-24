// #726 (RF008 AC#6, requisitos-index.md: "Permitir a criação de novos
// modelos de relatório sem depender de uma lista fixa"): a Coordenador/
// Administrador-defined report type, so a new report can be added without a
// code change to reports.routes.js's buildPreviewData dispatcher.
// `handlerKey` names which existing internal data-fetch handler a template
// runs against (buildPreviewData's own dispatch still owns the actual query
// logic per handler -- wiring buildPreviewData to look templates up by
// `code` instead of its current typeIncludes/normalizeTypeValue
// string-matching is deliberately left for a follow-up slice on this same
// issue, not done here). No dict-02 entity exists for this (confirmed
// absent, see #726) -- field naming follows BaseRecord's provenance shape
// (ELM-0006..ELM-0009: createdAt/createdBy/updatedAt/updatedBy,
// Reference-shaped as `User/<id>`) and ConsentTemplate's templateStatus
// vocabulary (P1X-0370), the closest existing precedents.
const HANDLER_KEYS = [
  'samplesByPatient',
  'patient',
  'sample',
  'sampleAnalysis',
  'temperature',
  'sensor',
  'equipment',
  'result',
  'withdrawalHistory',
  'tissueOriginHistory',
  'extracellularNetwork',
  'accessLogs',
];

const TEMPLATE_STATUSES = ['active', 'retired'];

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

class ReportTemplateModel {
  static fieldsOf(data = {}) {
    return {
      code: String(data.code || '').trim().toLowerCase(),
      name: String(data.name || '').trim(),
      description: data.description ? String(data.description).trim() : null,
      handlerKey: String(data.handlerKey || '').trim(),
      handlerOptions: data.handlerOptions && typeof data.handlerOptions === 'object' ? data.handlerOptions : {},
      isSystemDefined: Boolean(data.isSystemDefined),
      templateStatus: data.templateStatus || 'active',
      createdBy: data.createdBy ?? null,
      updatedBy: data.updatedBy ?? null,
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];

    if (!fields.code) {
      errors.push('code é obrigatório');
    } else if (!CODE_PATTERN.test(fields.code)) {
      errors.push('code deve conter apenas letras minúsculas, números e "_", começando com uma letra');
    }

    if (!fields.name) {
      errors.push('name é obrigatório');
    }

    if (!fields.handlerKey) {
      errors.push('handlerKey é obrigatório');
    } else if (!HANDLER_KEYS.includes(fields.handlerKey)) {
      errors.push(`handlerKey inválido: ${fields.handlerKey}`);
    }

    if (!TEMPLATE_STATUSES.includes(fields.templateStatus)) {
      errors.push(`templateStatus inválido: ${fields.templateStatus}`);
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const fields = this.fieldsOf(data);
    const now = new Date();
    return { ...fields, createdAt: data.createdAt || now, updatedAt: now };
  }
}

module.exports = ReportTemplateModel;
module.exports.HANDLER_KEYS = HANDLER_KEYS;
module.exports.TEMPLATE_STATUSES = TEMPLATE_STATUSES;
