/**
 * src/config/consentScopes.js
 * Definição centralizada de escopos de consentimento
 * Conformidade: LGPD + ANVISA
 * 
 * Qualquer novo escopo deve ser adicionado aqui
 */

const CONSENT_SCOPES = {
  // ===== PESQUISA =====
  USO_PESQUISA: {
    key: 'uso_pesquisa',
    label: 'Pesquisa Científica',
    description: 'Permitir uso de dados e amostras biológicas em pesquisas científicas',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 5, // 5 anos
    requiredFor: ['analise', 'extraction', 'sequenciamento']
  },

  // ===== COMERCIAL =====
  USO_COMERCIAL: {
    key: 'uso_comercial',
    label: 'Uso Comercial',
    description: 'Permitir uso de amostras para fins comerciais e desenvolvimento de produtos',
    category: 'commercial',
    riskLevel: 'high',
    retention: 365 * 7, // 7 anos
    requiredFor: ['comercializacao', 'patente', 'desenvolvimento_produto']
  },

  // ===== COMPARTILHAMENTO =====
  COMPARTILHAMENTO_PESQUISADORES: {
    key: 'compartilhamento_pesquisadores',
    label: 'Compartilhamento com Pesquisadores',
    description: 'Permitir compartilhamento de dados com pesquisadores externos',
    category: 'sharing',
    riskLevel: 'medium',
    retention: 365 * 3, // 3 anos
    requiredFor: ['compartilhar_externo', 'colaboracao']
  },

  COMPARTILHAMENTO_INTERNACIONAL: {
    key: 'compartilhamento_internacional',
    label: 'Compartilhamento Internacional',
    description: 'Permitir compartilhamento de dados com instituições internacionais',
    category: 'sharing',
    riskLevel: 'high',
    retention: 365 * 7, // 7 anos
    requiredFor: ['exportar_dados', 'colaboracao_internacional']
  },

  // ===== GENÉTICO =====
  ANALISE_GENETICA: {
    key: 'analise_genetica',
    label: 'Análise Genética',
    description: 'Permitir análises genéticas e determinação de variantes',
    category: 'genetic',
    riskLevel: 'high',
    retention: null, // Indefinido (conforme LGPD)
    requiredFor: ['sequenciamento', 'genotipagem', 'analise_cromossomica']
  },

  DADOS_GENETICOS_FAMILIA: {
    key: 'dados_geneticos_familia',
    label: 'Implicação Genética Familiar',
    description: 'Permitir compartilhamento de achados genéticos com família',
    category: 'genetic',
    riskLevel: 'high',
    retention: null, // Indefinido
    requiredFor: ['relatorio_familiar']
  },

  // ===== INCIDENTAL =====
  ACHADOS_INCIDENTAIS: {
    key: 'achados_incidentais',
    label: 'Achados Incidentais',
    description: 'Permitir comunicação de achados incidentais de relevância clínica',
    category: 'clinical',
    riskLevel: 'medium',
    retention: null, // Indefinido (informação clínica)
    requiredFor: ['resultado_incidental']
  },

  // ===== RECONTATO =====
  RECONTATO_PACIENTE: {
    key: 'recontato_paciente',
    label: 'Recontato do Paciente',
    description: 'Permitir que pesquisadores contatem o paciente para seguimento',
    category: 'contact',
    riskLevel: 'low',
    retention: 365 * 5, // 5 anos
    requiredFor: ['contato_paciente', 'seguimento_clinico']
  },

  // ===== USO SECUNDÁRIO =====
  USO_SECUNDARIO_DADOS: {
    key: 'uso_secundario_dados',
    label: 'Uso Secundário de Dados',
    description: 'Permitir uso de dados estruturados para análises secundárias não planejadas',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 5, // 5 anos
    requiredFor: ['mineracao_dados', 'analise_historica']
  },

  // ===== EDUCAÇÃO =====
  MATERIAL_EDUCACIONAL: {
    key: 'material_educacional',
    label: 'Material Educacional',
    description: 'Permitir uso de dados (anonimizados) em materiais educacionais',
    category: 'education',
    riskLevel: 'low',
    retention: 365 * 10, // 10 anos
    requiredFor: ['aula', 'seminario', 'publicacao_educacional']
  },

  // ===== CONTROLE =====
  AMOSTRA_CONTROLE: {
    key: 'amostra_controle',
    label: 'Uso como Controle',
    description: 'Permitir uso da amostra como controle em laboratório',
    category: 'research',
    riskLevel: 'low',
    retention: 365 * 2, // 2 anos
    requiredFor: ['controle_laboratorio', 'validacao']
  }
};

/**
 * Retorna todos os escopos em formato array
 */
function getAllScopes() {
  return Object.values(CONSENT_SCOPES);
}

/**
 * Retorna escopo por chave
 */
function getScopeByKey(key) {
  const scope = Object.values(CONSENT_SCOPES).find(s => s.key === key);
  return scope || null;
}

/**
 * Retorna escopos por categoria
 */
function getScopesByCategory(category) {
  return Object.values(CONSENT_SCOPES).filter(s => s.category === category);
}

/**
 * Retorna escopos com risco alto (para validação especial)
 */
function getHighRiskScopes() {
  return Object.values(CONSENT_SCOPES).filter(s => s.riskLevel === 'high');
}

/**
 * Verifica se um escopo existe
 */
function isScopeValid(key) {
  return Object.values(CONSENT_SCOPES).some(s => s.key === key);
}

/**
 * Retorna operações que requerem um escopo específico
 */
function getOperationsRequiringScope(scopeKey) {
  const scope = getScopeByKey(scopeKey);
  return scope ? scope.requiredFor : [];
}

/**
 * Valida um conjunto de escopos contra uma operação
 */
function validateScopesForOperation(grantedScopes, operation) {
  return Object.values(CONSENT_SCOPES).some(scope => {
    return grantedScopes.includes(scope.key) && scope.requiredFor.includes(operation);
  });
}

module.exports = {
  CONSENT_SCOPES,
  getAllScopes,
  getScopeByKey,
  getScopesByCategory,
  getHighRiskScopes,
  isScopeValid,
  getOperationsRequiringScope,
  validateScopesForOperation
};
