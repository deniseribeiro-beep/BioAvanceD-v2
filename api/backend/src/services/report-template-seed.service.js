const ReportTemplateModel = require('../models/ReportTemplate');

/**
 * #726 (RF008 AC#6): the existing hardcoded report types
 * (reports.routes.js's buildPreviewData typeIncludes/normalizeTypeValue
 * chain) migrated onto the ReportTemplate model as seeded, system-defined
 * rows -- one row per branch that chain currently handles. `handlerKey`
 * mirrors the branch each type dispatches to today; `handlerOptions` carries
 * the one branch-local flag buildPreviewData reads beyond the type itself
 * (the temperature branch's report-vs-control `mode`). These rows are the
 * "migrate existing types into the model" half of #726's design call --
 * repointing buildPreviewData's own dispatch to read templates instead of
 * string-matching `type` is a separate, not-yet-done follow-up slice on the
 * same issue (see ReportTemplate.js's header comment).
 */
const SYSTEM_REPORT_TEMPLATES = [
  { code: 'samples_by_patient', name: 'Amostras por Paciente', handlerKey: 'samplesByPatient' },
  { code: 'patient', name: 'Pacientes', handlerKey: 'patient' },
  { code: 'sample', name: 'Amostras', handlerKey: 'sample' },
  { code: 'sample_analysis', name: 'Análise das Amostras', handlerKey: 'sampleAnalysis' },
  { code: 'temperature_report', name: 'Relatório de Temperatura', handlerKey: 'temperature', handlerOptions: { mode: 'report' } },
  { code: 'temperature_control', name: 'Controle de Temperatura', handlerKey: 'temperature', handlerOptions: { mode: 'control' } },
  { code: 'sensor', name: 'Sensores', handlerKey: 'sensor' },
  { code: 'equipment', name: 'Equipamentos', handlerKey: 'equipment' },
  { code: 'result', name: 'Resultados', handlerKey: 'result' },
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
