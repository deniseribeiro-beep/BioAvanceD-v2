const ReportTemplateModel = require('../models/ReportTemplate');

/**
 * #726 (RF008 AC#6): the existing hardcoded report types
 * (reports.routes.js's buildPreviewData typeIncludes/normalizeTypeValue
 * chain) migrated onto the ReportTemplate model as seeded, system-defined
 * rows -- one row per branch that chain used to handle. `handlerKey` names
 * the handler function buildPreviewData now dispatches to via
 * REPORT_HANDLERS; `handlerOptions` carries the one branch-local flag a
 * handler reads beyond the type itself (temperature's report-vs-control
 * `mode`). `code` is the dispatch key buildPreviewData looks templates up
 * by (via toTemplateCode's camelCase->snake_case normalization) -- each one
 * here is deliberately the snake_case form of the matching frontend
 * `REPORT_TYPE_DEFINITIONS` `key` (report.constants.js), not the old
 * typeIncludes chain's free-form Portuguese/English matching, since that's
 * what the live frontend actually sends as `:type`. `audit` is a second row
 * onto the same `accessLogs` handlerKey as `access_logs` -- the frontend
 * exposes both as distinct menu entries (fallbackType 'Auditoria' vs 'Logs
 * de acesso') that the old typeIncludes(['log','audit','acesso','access'])
 * chain already collapsed onto the same `logs`-collection query; preserved
 * as-is here rather than treated as a taxonomy bug to fix in this slice.
 */
const SYSTEM_REPORT_TEMPLATES = [
  { code: 'samples_by_patient', name: 'Amostras por Paciente', handlerKey: 'samplesByPatient' },
  { code: 'patients', name: 'Pacientes', handlerKey: 'patient' },
  { code: 'samples', name: 'Amostras', handlerKey: 'sample' },
  { code: 'sample_analysis', name: 'Análise das Amostras', handlerKey: 'sampleAnalysis' },
  { code: 'temperature', name: 'Relatório de Temperatura', handlerKey: 'temperature', handlerOptions: { mode: 'report' } },
  { code: 'temperature_control', name: 'Controle de Temperatura', handlerKey: 'temperature', handlerOptions: { mode: 'control' } },
  { code: 'sensors', name: 'Sensores', handlerKey: 'sensor' },
  { code: 'equipment', name: 'Equipamentos', handlerKey: 'equipment' },
  { code: 'results', name: 'Resultados', handlerKey: 'result' },
  { code: 'audit', name: 'Auditoria', handlerKey: 'accessLogs' },
  { code: 'withdrawal_history', name: 'Histórico de Retirada', handlerKey: 'withdrawalHistory' },
  { code: 'tissue_origin_history', name: 'Origem de Tecido', handlerKey: 'tissueOriginHistory' },
  { code: 'extracellular_network', name: 'Rede Extracelular', handlerKey: 'extracellularNetwork' },
  { code: 'access_logs', name: 'Logs de Acesso', handlerKey: 'accessLogs' },
];

function buildSystemTemplateDocs() {
  return SYSTEM_REPORT_TEMPLATES.map((entry) => ReportTemplateModel.create({ ...entry, isSystemDefined: true }));
}

/**
 * Upserts by `code` (the model's own stable business key) -- skips a `code`
 * that already exists rather than overwriting it, same as
 * rbac-catalog-seed.service.js's `upsertByKey`, so a Coordenador's later
 * edit to a seeded row's name/description survives a re-run of this seed.
 */
async function upsertByCode(collection, doc) {
  const existing = await collection.findOne({ code: doc.code });
  if (existing) return existing;
  await collection.insertOne(doc);
  return doc;
}

async function seedReportTemplates(db) {
  const collection = db.collection('reportTemplates');
  const docs = buildSystemTemplateDocs();
  const stored = [];
  for (const doc of docs) {
    stored.push(await upsertByCode(collection, doc));
  }
  return { templates: stored };
}

module.exports = {
  seedReportTemplates,
  SYSTEM_REPORT_TEMPLATES,
};
