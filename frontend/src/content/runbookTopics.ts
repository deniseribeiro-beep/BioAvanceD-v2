export type RunbookTopic = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  route?: string;
  roles?: string[];
};

/**
 * Curated in-app runbook (G13) from docs/user-guides + docs/operations.
 */
export const RUNBOOK_TOPICS: RunbookTopic[] = [
  {
    id: 'intake',
    title: 'Novo atendimento (intake)',
    summary: 'Cadastro clínico com validação do dicionário ELM e vínculo a coleta.',
    steps: [
      'Menu Principal → New Registration (/next/intake).',
      'Preencha identificação, diagnóstico e amostra; campos obrigatórios seguem o dicionário canônico.',
      'Revise resumo e confirme — amostras nascem apenas pelo intake (não há “nova amostra” avulsa).',
    ],
    route: '/next/intake',
    roles: ['Administrador', 'Coordenador', 'Técnico'],
  },
  {
    id: 'inventory',
    title: 'Inventário e busca de amostras',
    summary: 'Lista operacional de espécimes, detalhe e armazenagem na mesma linha.',
    steps: [
      'Laboratório → Inventário de Amostras (/samples).',
      'Use um único campo de busca; abra o detalhe para ver armazenagem sem redigitar.',
      'Etiquetas e movimentações ficam nas ações do detalhe (/samples/:id/label, movimentos).',
    ],
    route: '/samples',
    roles: ['Administrador', 'Coordenador', 'Técnico', 'Usuário Externo'],
  },
  {
    id: 'label-scan',
    title: 'Etiqueta → leitura → consulta',
    summary: 'Code128/DataMatrix impressos devem resolver para o mesmo ID de inventário.',
    steps: [
      'No detalhe da amostra, gere etiqueta (/samples/:id/label).',
      'Leia o código com leitor USB ou câmera — o ID deve abrir o mesmo registro no inventário.',
      'Sem código legível: gere nova etiqueta e confira formato (Code128 + DataMatrix quando configurado).',
    ],
    route: '/samples',
  },
  {
    id: 'tcle',
    title: 'TCLE de pesquisa (construtor)',
    summary: 'Modelo versionado para consentimento de participante — distinto de Termos de uso do produto.',
    steps: [
      'Governança → Construtor de TCLE (/admin/tcle/new).',
      'Edite corpo com {{placeholders}}, itens granulares com código DUO (GA4GH), teste PDF antes de publicar.',
      'Salvar publica a versão para novos consentimentos; histórico mantém versões anteriores.',
      'Aceite remoto gov.br/ICP é fluxo do participante (e-consent), não confundir com Termos/Política do tenant.',
    ],
    route: '/admin/tcle/new',
    roles: ['Administrador', 'Coordenador'],
  },
  {
    id: 'import-fhir',
    title: 'Importação em lote FHIR',
    summary: 'Bundle R4 → staging → quarentena até TCLE ou documentação autorizada.',
    steps: [
      'Laboratório → Importação em lote (/patients/import-fhir).',
      'Etapas 1–5: arquivo → validar → revisar → salvar em quarentena → acompanhar status.',
      'Bookmarks antigos /import e /import/lgpd redirecionam para esta rota.',
    ],
    route: '/patients/import-fhir',
    roles: ['Administrador', 'Coordenador', 'Técnico'],
  },
  {
    id: 'import-quarantine',
    title: 'Quarentena de importação (planilha)',
    summary: 'Corrigir linhas rejeitadas de imports históricos (não é o fluxo FHIR principal).',
    steps: [
      'Laboratório → Quarentena de Importação (/import/quarantine).',
      'Abra um lote com linhas rejeitadas, corrija campos e reenvie.',
      'Para lote FHIR recente, prefira acompanhar status em Importação em lote.',
    ],
    route: '/import/quarantine',
    roles: ['Administrador', 'Coordenador', 'Técnico'],
  },
  {
    id: 'facility',
    title: 'Facility (equipamentos e temperatura)',
    summary: 'Cadastro de freezers, sensores, incidentes e políticas operacionais.',
    steps: [
      'Laboratório → Gestão de Facility (/facility-management).',
      'Use abas Equipamentos, Sensores, Temperatura e Incidentes conforme o papel.',
      'Atualizações críticas exigem perfil Técnico ou superior.',
    ],
    route: '/facility-management',
    roles: ['Administrador', 'Coordenador', 'Técnico'],
  },
  {
    id: 'tenant-invite',
    title: 'Convite e usuários do tenant',
    summary: 'Provisionamento de operadores pelo administrador (sem login social Google no produto 2.1).',
    steps: [
      'Primeiro admin: `createFirstAdmin.js` (allowlist `BOOTSTRAP_ADMIN_*`) — ver install-runbook §5.',
      'Demais operadores: Sistema → Usuários → Novo usuário → marque "Convidar usuário" → POST `/api/users/invites`.',
      'O operador abre `/invite/accept?token=...`, define a senha e faz login (sem Google OAuth no produto).',
      'Termos e Política de privacidade do produto são aceites no login — separados do TCLE de pesquisa.',
    ],
    route: '/system-management',
    roles: ['Administrador'],
  },
];