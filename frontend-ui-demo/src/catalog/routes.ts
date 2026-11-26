export type DemoRoute = {
  path: string;
  title: string;
  group: string;
  description: string;
  shell?: 'auth' | 'public' | 'app';
  highlight?: boolean;
};

/** Catálogo 1:1 com rotas de tela do App.tsx (destinos; redirects omitidos). */
export const DEMO_ROUTES: DemoRoute[] = [
  // Auth / público
  { path: '/login', title: 'Login', group: 'Auth / Público', description: 'Autenticação institucional', shell: 'auth' },
  { path: '/mfa-setup', title: 'Configurar MFA', group: 'Auth / Público', description: 'Setup de autenticação multifator', shell: 'auth' },
  { path: '/reset-password', title: 'Redefinir senha', group: 'Auth / Público', description: 'Fluxo de recuperação de senha', shell: 'auth' },
  { path: '/patient/e-consent', title: 'Painel e-Consent', group: 'Auth / Público', description: 'Painel de link de consentimento', shell: 'public' },
  { path: '/patient/e-consent/demo-token', title: 'Aceite participante (TCLE)', group: 'Auth / Público', description: 'Página pública de aceite do participante', shell: 'public' },
  { path: '/patient/e-consent/import/demo-token', title: 'Importação de consentimento', group: 'Auth / Público', description: 'Aceite de termo importado (FHIR)', shell: 'public' },
  { path: '/patients/demo-id/consent', title: 'Consent token page', group: 'Auth / Público', description: 'Landing do token de consentimento', shell: 'public' },

  // Principal
  { path: '/dashboard', title: 'Painel de Controle', group: 'Principal', description: 'KPI cards e atalhos operacionais', shell: 'app', highlight: true },
  { path: '/next/intake', title: 'Novo Cadastro (Intake)', group: 'Principal', description: 'Wizard clínico de intake', shell: 'app', highlight: true },
  { path: '/next', title: 'Foundation Overview', group: 'Principal', description: 'Visão foundation / pipeline', shell: 'app' },
  { path: '/next/contracts', title: 'Foundation Contracts', group: 'Principal', description: 'Contratos foundation', shell: 'app' },
  { path: '/patients', title: 'Diretório de Pacientes', group: 'Principal', description: 'Listagem e ações de participantes', shell: 'app' },
  { path: '/patients/import-fhir', title: 'Importação FHIR', group: 'Principal', description: 'Importação inteligente FHIR', shell: 'app' },

  // Laboratório / amostras
  { path: '/samples', title: 'Inventário de Amostras', group: 'Laboratório', description: 'Tabela de inventário', shell: 'app', highlight: true },
  { path: '/samples/demo-id', title: 'Detalhes da Amostra', group: 'Laboratório', description: 'Ficha completa da amostra', shell: 'app' },
  { path: '/samples/demo-id/label', title: 'Etiqueta da Amostra', group: 'Laboratório', description: 'Impressão de etiqueta', shell: 'app' },
  { path: '/samples/demo-id/chain', title: 'Cadeia de Custódia', group: 'Laboratório', description: 'Trilha de custódia', shell: 'app' },
  { path: '/samples/demo-id/movements', title: 'Movimentações', group: 'Laboratório', description: 'Histórico de movimentos', shell: 'app' },
  { path: '/samples/withdrawal-return', title: 'Retirada e Devolução', group: 'Laboratório', description: 'Registrar retirada/devolução', shell: 'app' },
  { path: '/samples/custody-reports', title: 'Relatórios de Custódia', group: 'Laboratório', description: 'Relatórios de custódia', shell: 'app' },
  { path: '/results', title: 'Arquivos de Análise', group: 'Laboratório', description: 'Resultados e uploads', shell: 'app' },
  { path: '/quality-descriptions', title: 'Descrições de Qualidade', group: 'Laboratório', description: 'Qualidade de amostras', shell: 'app' },
  { path: '/quality-descriptions/new', title: 'Nova Descrição de Qualidade', group: 'Laboratório', description: 'Formulário de qualidade', shell: 'app' },

  // Facility — obrigatório temperatura + grid
  { path: '/facility-management?tab=equipment', title: 'Facility · Equipamentos + CryoBox', group: 'Facility', description: 'Equipamentos e grid de localização', shell: 'app', highlight: true },
  { path: '/facility-management?tab=temperature', title: 'Facility · Temperatura', group: 'Facility', description: 'Controle de temperatura', shell: 'app', highlight: true },
  { path: '/facility-management?tab=history', title: 'Facility · Histórico', group: 'Facility', description: 'Histórico de leituras', shell: 'app' },
  { path: '/facility-management?tab=incidents', title: 'Facility · Incidentes', group: 'Facility', description: 'Gerenciamento de incidentes', shell: 'app' },
  { path: '/facility-management?tab=sensors', title: 'Facility · Sensores', group: 'Facility', description: 'Cadastro de sensores', shell: 'app' },
  { path: '/facility-management?tab=policies', title: 'Facility · Políticas', group: 'Facility', description: 'Políticas de temperatura', shell: 'app' },
  { path: '/equipment/new', title: 'Novo Equipamento', group: 'Facility', description: 'Formulário de equipamento', shell: 'app' },
  { path: '/sensors/new', title: 'Novo Sensor', group: 'Facility', description: 'Formulário de sensor', shell: 'app' },
  { path: '/policies/new', title: 'Nova Política', group: 'Facility', description: 'Formulário de política', shell: 'app' },

  // Governança / TCLE
  { path: '/admin/tcle/new', title: 'Construtor de TCLE', group: 'Governança', description: 'Novo termo com 4 blocos', shell: 'app', highlight: true },
  { path: '/admin/tcle/edit/demo-template', title: 'Editar TCLE', group: 'Governança', description: 'Edição versionada de termo', shell: 'app' },
  { path: '/consents', title: 'Consentimentos (TCLE)', group: 'Governança', description: 'Histórico e revogação', shell: 'app' },
  { path: '/biomarker-associations', title: 'Associações de Biomarcadores', group: 'Governança', description: 'Master data biomarcadores', shell: 'app' },
  { path: '/biomarker-associations/new', title: 'Nova Associação de Biomarcador', group: 'Governança', description: 'Formulário de biomarcador', shell: 'app' },
  { path: '/access-requests', title: 'Solicitações de Acesso', group: 'Governança', description: 'Pedidos e distribuição', shell: 'app' },

  // Importação
  { path: '/patients/import-fhir', title: 'Importação em lote', group: 'Importação', description: 'Importação em lote FHIR R4', shell: 'app' },
  { path: '/import/quarantine', title: 'Quarentena de Importação', group: 'Importação', description: 'Itens em quarentena', shell: 'app' },

  // Relatórios / auditoria
  { path: '/reports', title: 'Central de Relatórios', group: 'Relatórios', description: 'Catálogo de relatórios', shell: 'app' },
  { path: '/reports/templates', title: 'Modelos de Relatório', group: 'Relatórios', description: 'CRUD de templates', shell: 'app' },
  { path: '/reports/templates/new', title: 'Novo Modelo de Relatório', group: 'Relatórios', description: 'Formulário de template', shell: 'app' },
  { path: '/reports/query/custody', title: 'Consulta de Relatório', group: 'Relatórios', description: 'Filtro / preview / export', shell: 'app' },
  { path: '/reports/demo-id', title: 'Visualizar Relatório', group: 'Relatórios', description: 'Detalhe de relatório gerado', shell: 'app' },
  { path: '/logs', title: 'Logs de Auditoria', group: 'Relatórios', description: 'Trilha de auditoria', shell: 'app' },
  { path: '/logs/demo-id', title: 'Detalhe do Log', group: 'Relatórios', description: 'Entrada individual de log', shell: 'app' },

  // Sistema
  { path: '/system-management?tab=users', title: 'Sistema · Usuários', group: 'Sistema', description: 'Gestão de usuários', shell: 'app' },
  { path: '/system-management?tab=organizations', title: 'Sistema · Organizações', group: 'Sistema', description: 'Organizações', shell: 'app' },
  { path: '/organizations/new', title: 'Nova Organização', group: 'Sistema', description: 'Formulário de organização', shell: 'app' },
  { path: '/system-management?tab=collections', title: 'Sistema · Coleções', group: 'Sistema', description: 'Coleções MIABIS', shell: 'app' },
  { path: '/collections/new', title: 'Nova Coleção', group: 'Sistema', description: 'Formulário de coleção', shell: 'app' },
  { path: '/system-management?tab=security', title: 'Sistema · Segurança', group: 'Sistema', description: 'Configuração de segurança', shell: 'app' },
  { path: '/users/new', title: 'Novo Usuário', group: 'Sistema', description: 'Formulário de criação', shell: 'app' },
  { path: '/users/new/success', title: 'Usuário Criado', group: 'Sistema', description: 'Confirmação pós-criação', shell: 'app' },
  { path: '/backup', title: 'Backup', group: 'Sistema', description: 'Backup e restore', shell: 'app' },
  { path: '/settings/parameters', title: 'Parâmetros', group: 'Sistema', description: 'Tipos de análise / parâmetros', shell: 'app' },
  { path: '/admin/dicionario', title: 'Dicionário de Dados', group: 'Sistema', description: 'Referência do dicionário', shell: 'app' },
  { path: '/user/security', title: 'Segurança do Usuário', group: 'Sistema', description: 'MFA e senha do usuário logado', shell: 'app' },
  { path: '/security/mfa-setup', title: 'MFA (autenticado)', group: 'Sistema', description: 'Setup MFA pós-login', shell: 'app' },
];

export const SIDEBAR_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { path: '/dashboard', label: 'Painel' },
      { path: '/next/intake', label: 'Novo Cadastro' },
      { path: '/patients', label: 'Pacientes' },
      { path: '/patients/import-fhir', label: 'Importação FHIR' },
    ],
  },
  {
    label: 'Laboratório',
    items: [
      { path: '/samples', label: 'Inventário de Amostras' },
      { path: '/samples/demo-id', label: 'Detalhes da Amostra' },
      { path: '/samples/withdrawal-return', label: 'Retirada / Devolução' },
      { path: '/results', label: 'Arquivos de Análise' },
      { path: '/quality-descriptions', label: 'Qualidade' },
    ],
  },
  {
    label: 'Facility',
    items: [
      { path: '/facility-management?tab=equipment', label: 'Equipamentos + Grid' },
      { path: '/facility-management?tab=temperature', label: 'Temperatura' },
      { path: '/facility-management?tab=history', label: 'Histórico' },
      { path: '/facility-management?tab=incidents', label: 'Incidentes' },
      { path: '/facility-management?tab=sensors', label: 'Sensores' },
      { path: '/facility-management?tab=policies', label: 'Políticas' },
    ],
  },
  {
    label: 'Governança',
    items: [
      { path: '/admin/tcle/new', label: 'Construtor de TCLE' },
      { path: '/consents', label: 'Consentimentos' },
      { path: '/biomarker-associations', label: 'Biomarcadores' },
      { path: '/access-requests', label: 'Solicitações de Acesso' },
      { path: '/patients/import-fhir', label: 'Importação em lote' },
      { path: '/import/quarantine', label: 'Quarentena' },
    ],
  },
  {
    label: 'Relatórios',
    items: [
      { path: '/reports', label: 'Central de Relatórios' },
      { path: '/reports/templates', label: 'Modelos' },
      { path: '/logs', label: 'Logs de Auditoria' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { path: '/system-management?tab=users', label: 'Usuários' },
      { path: '/system-management?tab=organizations', label: 'Organizações' },
      { path: '/system-management?tab=collections', label: 'Coleções' },
      { path: '/system-management?tab=security', label: 'Segurança' },
      { path: '/backup', label: 'Backup' },
      { path: '/settings/parameters', label: 'Parâmetros' },
      { path: '/admin/dicionario', label: 'Dicionário' },
      { path: '/user/security', label: 'Minha Segurança' },
    ],
  },
] as const;

export function groupRoutes() {
  const map = new Map<string, DemoRoute[]>();
  for (const route of DEMO_ROUTES) {
    const list = map.get(route.group) || [];
    list.push(route);
    map.set(route.group, list);
  }
  return map;
}
