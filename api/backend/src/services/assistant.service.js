const IntelligentAssistantModel = require('../models/IntelligentAssistant');
const logService = require('../services/log.service');
const logger = require('../utils/logger');

/**
 * Service do Assistente Inteligente
 * RF011 - Assistente Inteligente (IA)
 * Restrições LGPD: Não acessa dados sensíveis, apenas metadados e instruções
 */
class AssistantService {
  /**
   * Responde pergunta do usuário
   */
  async answerQuestion(db, question, userRole, contextScope = 'Interface', language = 'pt-BR') {
    try {
      // Valida acesso (sem dados sensíveis)
      if (!IntelligentAssistantModel.validateAccess(true)) {
        throw new Error('Acesso negado - operação requer dados sensíveis');
      }

      // Valida contextScope
      if (!IntelligentAssistantModel.isValidContextScope(contextScope)) {
        throw new Error('ContextScope inválido');
      }

      // Aqui você integraria com o modelo de IA real
      // Por enquanto, retorna resposta simulada baseada no contexto
      const response = this.generateResponse(question, userRole, contextScope, language);

      return {
        answer: response,
        contextScope,
        modelVersion: '1.0.0', // Versão do modelo de IA
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Erro ao processar pergunta:', error.message);
      throw error;
    }
  }

  /**
   * Sugere ações baseadas na tela atual
   */
  async suggestActions(db, screenID, userRole) {
    try {
      // Mapeamento de ações por tela e role
      const actionsMap = {
        'dashboard': {
          'UsuarioExterno': ['Consultar relatórios', 'Usar assistente'],
          'Tecnico': ['Cadastrar amostra', 'Registrar retirada', 'Consultar temperatura'],
          'Coordenador': ['Cadastrar paciente', 'Cadastrar amostra', 'Gerar relatórios'],
          'Administrador': ['Gerenciar usuários', 'Configurar sistema', 'Visualizar logs']
        },
        'patients': {
          'Tecnico': ['Visualizar pacientes', 'Buscar paciente'],
          'Coordenador': ['Cadastrar paciente', 'Editar paciente', 'Visualizar histórico'],
          'Administrador': ['Gerenciar pacientes', 'Exportar dados']
        },
        'samples': {
          'Tecnico': ['Cadastrar amostra', 'Registrar retirada', 'Visualizar localização'],
          'Coordenador': ['Cadastrar amostra', 'Gerenciar amostras', 'Visualizar histórico'],
          'Administrador': ['Gerenciar amostras', 'Importar dados', 'Exportar dados']
        }
      };

      const roleName = this.getRoleName(userRole);
      const actions = actionsMap[screenID]?.[roleName] || ['Navegar pelo sistema', 'Usar assistente'];

      return {
        screenID,
        userRole: roleName,
        suggestions: actions,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Erro ao sugerir ações:', error.message);
      throw error;
    }
  }

  /**
   * Inicia tutorial passo a passo
   */
  async startTutorial(db, flowID, userRole) {
    try {
      // Mapeamento de tutoriais
      const tutorials = {
        'cadastro-paciente': {
          steps: [
            'Preencha o nome completo do paciente',
            'Informe a data de nascimento',
            'Selecione o sexo biológico',
            'Preencha os dados clínicos relevantes',
            'Clique em "Salvar" para finalizar'
          ],
          title: 'Tutorial: Cadastro de Paciente'
        },
        'cadastro-amostra': {
          steps: [
            'Selecione o paciente associado',
            'Informe o tipo de amostra',
            'Preencha a origem da amostra',
            'Defina a localização de armazenamento',
            'Gere o código de barras',
            'Clique em "Salvar" para finalizar'
          ],
          title: 'Tutorial: Cadastro de Amostra'
        }
      };

      const tutorial = tutorials[flowID] || {
        steps: ['Tutorial não disponível para este fluxo'],
        title: 'Tutorial'
      };

      return {
        flowID,
        tutorial,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Erro ao iniciar tutorial:', error.message);
      throw error;
    }
  }

  /**
   * Registra log de orientação (anonimizado via auditLogger)
   */
  async registerGuidanceLog(db, userID, action, req) {
    try {
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'ASSISTANT_GUIDANCE',
        entity: 'IntelligentAssistant',
        result: 'success',
        severity: 'info',
        message: `Orientação fornecida: ${action}`,
        payload: {
          action,
          noSensitiveData: true
        },
        req: req,
        module: 'IA Assistente'
      });
    } catch (error) {
      logger.error('Erro ao registrar log de orientação:', error.message);
      // Não lança erro para não quebrar o fluxo principal
    }
  }

  /**
   * Gera resposta baseada no contexto (simulação)
   */
  generateResponse(question, userRole, contextScope, language = 'pt-BR') {
    const { translate } = require('../i18n');
    const roleName = this.getRoleName(userRole);
    const roleNameTranslated = this.getRoleNameTranslated(userRole, language);
    
    // Respostas pré-definidas baseadas em palavras-chave
    const lowerQuestion = question.toLowerCase();
    
    // Detecta palavras-chave em ambos os idiomas
    const registerKeywords = ['cadastrar', 'cadastro', 'register', 'create', 'new'];
    const sampleKeywords = ['amostra', 'sample'];
    const temperatureKeywords = ['temperatura', 'temperature', 'sensor', 'sensor'];
    const reportKeywords = ['relatório', 'report', 'relatorio'];
    
    if (registerKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return translate('assistant.responses.register', language).replace('{role}', roleNameTranslated).replace('{{role}}', roleNameTranslated);
    }
    
    if (sampleKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return translate('assistant.responses.sample', language);
    }
    
    if (temperatureKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return translate('assistant.responses.temperature', language);
    }
    
    if (reportKeywords.some(keyword => lowerQuestion.includes(keyword))) {
      return translate('assistant.responses.report', language);
    }
    
    return translate('assistant.responses.default', language).replace('{role}', roleNameTranslated).replace('{{role}}', roleNameTranslated);
  }

  /**
   * Retorna nome do role traduzido
   */
  getRoleNameTranslated(accessType, language = 'pt-BR') {
    const { translate } = require('../i18n');
    const roleMap = {
      1: translate('roles.externalUser', language),
      2: translate('roles.technician', language),
      3: translate('roles.coordinator', language),
      4: translate('roles.administrator', language)
    };
    return roleMap[accessType] || translate('roles.externalUser', language);
  }

  /**
   * Retorna nome do role
   */
  getRoleName(accessType) {
    const roles = {
      1: 'UsuarioExterno',
      2: 'Tecnico',
      3: 'Coordenador',
      4: 'Administrador'
    };
    return roles[accessType] || 'UsuarioExterno';
  }
}

module.exports = new AssistantService();

