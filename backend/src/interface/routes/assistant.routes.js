const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const assistantService = require('../../services/assistant.service');
const logger = require('../../utils/logger');

function resolveSuggestionsToActions(suggestions) {
  const routeMap = {
    'Consultar relatórios': '/reports',
    'Usar assistente': '/assistant',
    'Cadastrar amostra': '/samples/new',
    'Registrar retirada': '/samples/withdrawal-return',
    'Consultar temperatura': '/facility-management?tab=temperature',
    'Cadastrar paciente': '/patients/new',
    'Gerar relatórios': '/reports',
    'Gerenciar usuários': '/system-management?tab=users',
    'Configurar sistema': '/settings/parameters',
    'Visualizar logs': '/logs',
    'Visualizar pacientes': '/patients',
    'Buscar paciente': '/patients',
    'Editar paciente': '/patients',
    'Visualizar histórico': '/logs',
    'Gerenciar pacientes': '/patients',
    'Exportar dados': '/reports',
    'Gerenciar amostras': '/samples',
    'Importar dados': '/import',
    'Navegar pelo sistema': '/dashboard'
  };

  return (suggestions || []).map((action) => ({
    action,
    description: action,
    route: routeMap[action] || '/dashboard'
  }));
}

router.post('/answer', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ success: false, error: 'question é obrigatório' });
    }

    const userRole = req.user?.accessType || 1;
    const language = req.language || 'pt-BR';
    const data = await assistantService.answerQuestion(db, question, userRole, 'Interface', language);

    return res.status(200).json({
      success: true,
      data: {
        answer: data.answer,
        suggestions: []
      }
    });
  } catch (error) {
    logger.error('Erro em /assistant/answer:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao processar pergunta', message: error.message });
  }
});

router.post('/consult', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ success: false, error: 'question é obrigatório' });
    }

    const userRole = req.user?.accessType || 1;
    const language = req.language || 'pt-BR';
    const data = await assistantService.answerQuestion(db, question, userRole, 'Interface', language);

    return res.status(200).json({
      success: true,
      data: {
        answer: data.answer,
        suggestions: []
      }
    });
  } catch (error) {
    logger.error('Erro em /assistant/consult:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao consultar assistente', message: error.message });
  }
});

router.post('/question', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ success: false, error: 'question é obrigatório' });
    }

    const userRole = req.user?.accessType || 1;
    const language = req.language || 'pt-BR';
    const data = await assistantService.answerQuestion(db, question, userRole, 'Interface', language);

    return res.status(200).json({
      success: true,
      data: {
        answer: data.answer,
        suggestions: []
      }
    });
  } catch (error) {
    logger.error('Erro em /assistant/question:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao processar pergunta', message: error.message });
  }
});

router.post('/contextual-help', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { context } = req.body;
    const userRole = req.user?.accessType || 1;
    const language = req.language || 'pt-BR';
    const answerData = await assistantService.answerQuestion(db, `Ajuda contextual: ${context || 'sistema'}`, userRole, 'Interface', language);

    return res.status(200).json({
      success: true,
      data: {
        answer: answerData.answer,
        contextualHelp: {
          title: `Ajuda: ${context || 'sistema'}`,
          content: answerData.answer,
          relatedActions: ['assistant', 'dashboard', 'reports']
        },
        suggestions: []
      }
    });
  } catch (error) {
    logger.error('Erro em /assistant/contextual-help:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao obter ajuda contextual', message: error.message });
  }
});

router.post('/tutorial', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { topic } = req.body;
    const userRole = req.user?.accessType || 1;
    const topicMap = {
      'cadastrar paciente': 'cadastro-paciente',
      paciente: 'cadastro-paciente',
      amostra: 'cadastro-amostra',
      'cadastrar amostra': 'cadastro-amostra'
    };
    const flowID = topicMap[String(topic || '').toLowerCase()] || 'cadastro-paciente';
    const tutorialData = await assistantService.startTutorial(db, flowID, userRole);

    return res.status(200).json({
      success: true,
      data: {
        topic: topic || tutorialData.tutorial?.title || 'Tutorial',
        steps: tutorialData.tutorial?.steps || [],
        estimatedTime: `${Math.max(3, (tutorialData.tutorial?.steps || []).length * 2)} min`
      }
    });
  } catch (error) {
    logger.error('Erro em /assistant/tutorial:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao obter tutorial', message: error.message });
  }
});

router.post('/suggestions', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { context } = req.body;
    const userRole = req.user?.accessType || 1;
    const screenMap = {
      paciente: 'patients',
      amostra: 'samples',
      dashboard: 'dashboard'
    };
    const screenID = screenMap[String(context || '').toLowerCase()] || 'dashboard';
    const data = await assistantService.suggestActions(db, screenID, userRole);
    const suggestions = resolveSuggestionsToActions(data.suggestions);

    return res.status(200).json({
      success: true,
      data: { suggestions }
    });
  } catch (error) {
    logger.error('Erro em /assistant/suggestions:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao obter sugestões', message: error.message });
  }
});

router.post('/suggest', authenticate, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    }

    const { context } = req.body;
    const userRole = req.user?.accessType || 1;
    const screenMap = {
      paciente: 'patients',
      amostra: 'samples',
      dashboard: 'dashboard'
    };
    const screenID = screenMap[String(context || '').toLowerCase()] || 'dashboard';
    const data = await assistantService.suggestActions(db, screenID, userRole);
    const suggestions = resolveSuggestionsToActions(data.suggestions);

    return res.status(200).json({
      success: true,
      data: { suggestions }
    });
  } catch (error) {
    logger.error('Erro em /assistant/suggest:', error.message);
    return res.status(400).json({ success: false, error: 'Erro ao obter sugestões', message: error.message });
  }
});

module.exports = router;
