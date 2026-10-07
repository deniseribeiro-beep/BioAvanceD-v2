export const REPORT_TYPE_DEFINITIONS = [
  {
    key: 'patients',
    type: 'reports.types.patients',
    fallbackType: 'Pacientes',
    icon: '👥',
    description: 'reports.types.patientsDescription',
    fallbackDescription: 'Resumo dos pacientes cadastrados e seus vínculos clínicos.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [1, 2, 3, 4],
  },
  {
    key: 'samplesByPatient',
    type: 'reports.types.samplesByPatient',
    fallbackType: 'Amostras por paciente',
    icon: '🔗',
    description: 'reports.types.samplesByPatientDescription',
    fallbackDescription: 'Agrupamento de amostras vinculadas a cada paciente.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [1, 2, 3, 4],
  },
  {
    key: 'samples',
    type: 'reports.types.samples',
    fallbackType: 'Amostras',
    icon: '🧪',
    description: 'reports.types.samplesDescription',
    fallbackDescription: 'Inventário analítico das amostras e seus status.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [1, 2, 3, 4],
  },
  {
    key: 'temperature',
    type: 'reports.types.temperature',
    fallbackType: 'Temperatura',
    icon: '🌡️',
    description: 'reports.types.temperatureDescription',
    fallbackDescription: 'Leituras e alertas de monitoramento térmico.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'temperatureControl',
    type: 'reports.types.temperatureControl',
    fallbackType: 'Controle de temperatura',
    icon: '🌡️',
    description: 'reports.types.temperatureControlDescription',
    fallbackDescription: 'Painel operacional de monitoramento e correções.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'sensors',
    type: 'reports.types.sensors',
    fallbackType: 'Sensores',
    icon: '📡',
    description: 'reports.types.sensorsDescription',
    fallbackDescription: 'Inventário de sensores e seus sinais ativos.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'equipment',
    type: 'reports.types.equipment',
    fallbackType: 'Equipamentos',
    icon: '🔧',
    description: 'reports.types.equipmentDescription',
    fallbackDescription: 'Visão consolidada dos ativos e sua manutenção.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'results',
    type: 'reports.types.results',
    fallbackType: 'Resultados',
    icon: '📊',
    description: 'reports.types.resultsDescription',
    fallbackDescription: 'Resultados analíticos e sumários executivos.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [1, 2, 3, 4],
  },
  {
    key: 'audit',
    type: 'reports.types.audit',
    fallbackType: 'Auditoria',
    icon: '📝',
    description: 'reports.types.auditDescription',
    fallbackDescription: 'Rastros operacionais e trilhas de auditoria.',
    allowedRoles: ['Administrador', 'Coordenador'],
    allowedAccessTypes: [3, 4],
  },
  {
    key: 'tissueOriginHistory',
    type: 'reports.types.tissueOriginHistory',
    fallbackType: 'Origem tecidual',
    icon: '🧬',
    description: 'reports.types.tissueOriginHistoryDescription',
    fallbackDescription: 'Histórico da origem dos tecidos e derivados.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'extracellularNetwork',
    type: 'reports.types.extracellularNetwork',
    fallbackType: 'Rede extracelular',
    icon: '🔬',
    description: 'reports.types.extracellularNetworkDescription',
    fallbackDescription: 'Rede analítica e relações entre registros.',
    allowedRoles: ['Administrador', 'Coordenador'],
    allowedAccessTypes: [3, 4],
  },
  {
    key: 'withdrawalHistory',
    type: 'reports.types.withdrawalHistory',
    fallbackType: 'Histórico de retirada',
    icon: '📤',
    description: 'reports.types.withdrawalHistoryDescription',
    fallbackDescription: 'Movimentações, retiradas e devoluções de amostras.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [2, 3, 4],
  },
  {
    key: 'accessLogs',
    type: 'reports.types.accessLogs',
    fallbackType: 'Logs de acesso',
    icon: '🔐',
    description: 'reports.types.accessLogsDescription',
    fallbackDescription: 'Eventos de autenticação e acesso às áreas do sistema.',
    allowedRoles: ['Administrador', 'Coordenador'],
    allowedAccessTypes: [3, 4],
  },
  {
    key: 'sampleAnalysis',
    type: 'reports.types.sampleAnalysis',
    fallbackType: 'Análise de amostras',
    icon: '🔍',
    description: 'reports.types.sampleAnalysisDescription',
    fallbackDescription: 'Consultas analíticas sobre o inventário de amostras.',
    allowedRoles: ['Administrador', 'Coordenador', 'Técnico'],
    allowedAccessTypes: [1, 2, 3, 4],
  },
];

export function getReportTypeDefinition(typeOrKey) {
  const normalized = String(typeOrKey || '').trim();
  return REPORT_TYPE_DEFINITIONS.find((item) => item.key === normalized || item.type === normalized) || null;
}


// #735 (RF008 AC#6): a template created on ReportTemplatesPage becomes a
// menu entry too. Only active, operator-created templates are added: the
// system rows are already the definitions above.
// A code is compared in the backend's snake_case form (toTemplateCode in
// reports.routes.js), so `samples_by_patient` names the samplesByPatient key.
function toTemplateCode(value) {
  return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * @typedef {{ key: string, type: string, fallbackType: string, icon: string, description: string,
 *   fallbackDescription: string, allowedRoles?: string[], allowedAccessTypes?: number[],
 *   handlerKey?: string, isCustomTemplate?: boolean }} ReportMenuEntry
 * @param {ReportMenuEntry[]} definitions
 * @param {Array<{ code?: string, name?: string, description?: string | null, handlerKey?: string,
 *   isSystemDefined?: boolean, templateStatus?: string }> | null | undefined} templates
 * @returns {ReportMenuEntry[]}
 */
export function mergeCustomTemplates(definitions, templates) {
  if (!Array.isArray(templates)) {
    return definitions;
  }
  const takenCodes = new Set(definitions.map((definition) => toTemplateCode(definition.key)));
  const custom = templates
    .filter((template) => template && !template.isSystemDefined && template.templateStatus === 'active')
    .filter((template) => template.code && !takenCodes.has(toTemplateCode(template.code)))
    .map((template) => ({
      key: template.code,
      type: template.code,
      fallbackType: template.name || template.code,
      icon: '📄',
      description: '',
      fallbackDescription: template.description || 'Modelo de relatório personalizado.',
      handlerKey: template.handlerKey,
      isCustomTemplate: true,
    }));
  return custom.length > 0 ? [...definitions, ...custom] : definitions;
}
