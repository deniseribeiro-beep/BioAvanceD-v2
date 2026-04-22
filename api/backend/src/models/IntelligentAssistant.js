/**
 * Modelo de validação e estrutura para IntelligentAssistant
 * RF011 - Assistente Inteligente
 * Baseado no Dicionário Técnico Completo
 */
class IntelligentAssistantModel {
  static validate(data) {
    const errors = [];

    if (!data.modelVersion || typeof data.modelVersion !== 'string') {
      errors.push('modelVersion é obrigatório e deve ser string');
    }

    if (!data.contextScope || typeof data.contextScope !== 'string') {
      errors.push('contextScope é obrigatório e deve ser string');
    }

    // Valida contextScope permitidos
    const validScopes = ['Interface', 'Fluxo Tutorial', 'Documentação', 'Perguntas sobre Procedimentos'];
    if (!validScopes.includes(data.contextScope)) {
      errors.push(`contextScope deve ser um dos: ${validScopes.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static create(data) {
    return {
      assistantID: data.assistantID || null, // Int - Identificador interno único
      modelVersion: data.modelVersion, // String - Versão do modelo de IA (ex: GPT-4.1, Llama3-Bio-Optimized)
      contextScope: data.contextScope, // String - Escopo de contexto permitido
      lastInteraction: data.lastInteraction ? (data.lastInteraction instanceof Date ? data.lastInteraction : new Date(data.lastInteraction)) : null, // DateTime - 0..1 (opcional)
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /**
   * Valida se o acesso pode ser realizado sem dados sensíveis
   */
  static validateAccess(noSensitiveData) {
    return noSensitiveData === true;
  }

  /**
   * Valida se o contextScope é permitido
   */
  static isValidContextScope(contextScope) {
    const validScopes = ['Interface', 'Fluxo Tutorial', 'Documentação', 'Perguntas sobre Procedimentos'];
    return validScopes.includes(contextScope);
  }
}

module.exports = IntelligentAssistantModel;

