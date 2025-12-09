const express = require('express');
const router = express.Router();
const assistantController = require('../controllers/assistant.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');

// RF011 - Assistente Inteligente
// Permite acesso com ou sem autenticação (para usuários externos)

// Compatível com frontend
router.post('/consult', optionalAuth, assistantController.answerQuestion.bind(assistantController));
router.post('/answer', optionalAuth, assistantController.answerQuestion.bind(assistantController));
router.post('/contextual-help', optionalAuth, assistantController.suggestActions.bind(assistantController));
router.post('/tutorial', optionalAuth, (req, res) => {
  req.body.flowID = req.body.topic; // Compatibilidade
  assistantController.startTutorial(req, res);
});
router.post('/suggestions', optionalAuth, (req, res) => {
  req.body.screenID = req.body.context; // Compatibilidade
  assistantController.suggestActions(req, res);
});

// Endpoints originais (mantidos)
router.post('/question', optionalAuth, assistantController.answerQuestion.bind(assistantController));
router.post('/suggest', optionalAuth, assistantController.suggestActions.bind(assistantController));

module.exports = router;

