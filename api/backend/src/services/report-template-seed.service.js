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
 * #1064: a bare "already exists? skip" upsert (matching
 * rbac-catalog-seed.service.js's old `upsertByKey`, before #646 Wave 3's
 * `upsertRole` fix) froze `handlerKey`/`handlerOptions`/`isSystemDefined` at
 * whatever they were the first time a `code` was seeded -- indistinguishable
 * from an operator edit, so a later SYSTEM_REPORT_TEMPLATES correction (e.g.
 * a fixed `handlerOptions.mode`) never reached an already-seeded database,
 * on any later re-run or process restart, silently.
 *
 * Mirrors `upsertRole`'s shape: reconcile ONLY the fields that went stale,
 * and return the existing document untouched -- issuing no `updateOne` at
 * all -- when none of them differ, so a no-op re-run performs no write.
 *
 * `handlerKey`/`handlerOptions`/`isSystemDefined` are system-owned (derived
 * from SYSTEM_REPORT_TEMPLATES, the code's own source of truth) and are
 * reconciled. Everything else on the existing document -- `name`,
 * `description`, `templateStatus`, `createdBy`, `updatedBy`, `createdAt`,
 * `code` -- is operator-owned or identity/audit and is never touched, so a
 * Coordenador's later edit to a seeded row's name/description (or a
 * Coordenador retiring a system template via `templateStatus`) survives a
 * re-run of this seed.
 */
async function upsertByCode(collection, doc) {
  const filter = { code: doc.code };
  const existing = await collection.findOne(filter);
  if (!existing) {
    await collection.insertOne(doc);
    return doc;
  }

  const handlerOptionsChanged = JSON.stringify(existing.handlerOptions || {}) !== JSON.stringify(doc.handlerOptions || {});
  const handlerKeyChanged = existing.handlerKey !== doc.handlerKey;
  const isSystemDefinedChanged = Boolean(existing.isSystemDefined) !== Boolean(doc.isSystemDefined);
  if (!handlerOptionsChanged && !handlerKeyChanged && !isSystemDefinedChanged) return existing;

  const reconciled = {
    handlerKey: doc.handlerKey,
    handlerOptions: doc.handlerOptions,
    isSystemDefined: doc.isSystemDefined,
    updatedAt: new Date(),
  };
  await collection.updateOne(filter, { $set: reconciled });
  return { ...existing, ...reconciled };
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
