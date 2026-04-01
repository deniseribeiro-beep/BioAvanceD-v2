const assistantService = require('../services/assistant.service');
const logger = require('../utils/logger');

/**
 * Controller do Assistente Inteligente
 * RF011 - Assistente Inteligente (IA)
 */
class AssistantController {
  async answerQuestion(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { question, contextScope } = req.body;
      const userRole = req.user?.accessType || 1;
      const language = req.language || 'pt-BR';

      if (!question) {
        return res.status(400).json({
          success: false,
          error: req.t('assistant.questionRequired')
        });
      }

      const response = await assistantService.answerQuestion(
        db,
        question,
        userRole,
        contextScope || 'Interface',
        language
      );

      // Registra log de orientação (sem dados pessoais)
      await assistantService.registerGuidanceLog(
        db,
        req.user?.userID,
        `Pergunta: ${question.substring(0, 50)}`,
        req
      );

      return res.status(200).json({
        success: true,
        data: response
      });
    } catch (error) {
      logger.error('Erro ao processar pergunta:', error.message);
      return res.status(400).json({
        success: false,
        error: req.t('assistant.errorProcessing'),
        message: error.message
      });
    }
  }

  async suggestActions(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { screenID } = req.body;
      const userRole = req.user?.accessType || 1;

      if (!screenID) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('assistant.screenIDRequired')) || 'screenID é obrigatório'
        });
      }

      const suggestions = await assistantService.suggestActions(db, screenID, userRole);

      // Registra log
      await assistantService.registerGuidanceLog(
        db,
        req.user?.userID,
        `Sugestões para tela: ${screenID}`,
        req
      );

      return res.status(200).json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      logger.error('Erro ao sugerir ações:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('assistant.suggestActionsError')) || 'Erro ao sugerir ações',
        message: error.message
      });
    }
  }

  async startTutorial(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: (req.t && req.t('errors.databaseUnavailable')) || 'Banco de dados não disponível'
        });
      }

      const { flowID } = req.body;
      const userRole = req.user?.accessType || 1;

      if (!flowID) {
        return res.status(400).json({
          success: false,
          error: (req.t && req.t('assistant.flowIDRequired')) || 'flowID é obrigatório'
        });
      }

      const tutorial = await assistantService.startTutorial(db, flowID, userRole);

      // Registra log
      await assistantService.registerGuidanceLog(
        db,
        req.user?.userID,
        `Tutorial iniciado: ${flowID}`,
        req
      );

      return res.status(200).json({
        success: true,
        data: tutorial
      });
    } catch (error) {
      logger.error('Erro ao iniciar tutorial:', error.message);
      return res.status(400).json({
        success: false,
        error: (req.t && req.t('assistant.startTutorialError')) || 'Erro ao iniciar tutorial',
        message: error.message
      });
    }
  }
}

module.exports = new AssistantController();

