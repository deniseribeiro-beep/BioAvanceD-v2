/**
 * GUIA DE INTEGRAÇÃO: SISTEMA DE SEGURANÇA E CONFORMIDADE LGPD
 * 
 * Este documento explica como integrar e usar o sistema de bloqueio ético,
 * alertas de segurança e conformidade implementado.
 * 
 * Novembro 2025 - BioAvanceD Mestrado/FAPESP
 */

// =============================================================================
// PARTE 1: INICIE O SISTEMA NO SERVER.JS
// =============================================================================

/*
No seu server.js, após conectar ao banco de dados:

const express = require('express');
const { connectDB } = require('./src/database/mongo');
const { initializeSecuritySystem } = require('./src/middleware/integrationSecurityMiddleware');

const app = express();

// ... middlewares padrão ...

// Conecta ao banco
let db;
(async () => {
  db = await connectDB();
  if (db) {
    app.locals.db = db;
    
    // ✅ INICIALIZA SISTEMA DE SEGURANÇA (executar após conectar DB!)
    await initializeSecuritySystem(app, db);
  }
})();

// ... registra rotas ...
app.use('/api/samples', require('./src/routes/sample.routes'));
app.use('/api/results', require('./src/routes/result.routes'));
app.use('/api/compliance', require('./src/routes/compliance.routes')); // ← NOVA ROTA

app.listen(3000);
*/

// =============================================================================
// PARTE 2: COMPONENTES DO SISTEMA
// =============================================================================

/*
O sistema implementado consiste em:

1. ✅ BLOQUEIO ÉTICO (authConsent.js)
   - Middleware que valida consentimento antes de operações
   - Retorna 403 se consentimento ausente/revogado/escopo insuficiente
   - Registra todas as tentativas em auditoria

2. ✅ CONFIGURAÇÃO DE ESCOPOS (consentScopes.js)
   - Enum centralizado de todos os escopos de consentimento
   - Define categoria, risco, retenção de dados
   - Mapeia quais operações exigem cada escopo

3. ✅ ALERTAS DE SEGURANÇA (securityAlerts.service.js)
   - Registra eventos críticos de segurança
   - Detecta atividades suspeitas (múltiplas tentativas)
   - Detecta PII exposure
   - Permite handlers customizados (email, Slack, etc)

4. ✅ RELATÓRIOS DE CONFORMIDADE (complianceReport.service.js)
   - Gera relatórios completos num período
   - Calcula score de conformidade (0-100)
   - Fornece dashboard de métricas
   - Exporta em JSON/CSV

5. ✅ INTEGRAÇÃO AUTOMÁTICA (integrationSecurityMiddleware.js)
   - Aplica bloqueio ético automaticamente em rotas críticas
   - Captura bloqueios e gera alertas
   - Detecta padrões de ataque
*/

// =============================================================================
// PARTE 3: USANDO ROTAS DE CONFORMIDADE
// =============================================================================

/*
DASHBOARD DE CONFORMIDADE:
GET /api/compliance/dashboard?days=30
Headers: Authorization: Bearer <token>
Response:
{
  "complianceScore": 85,
  "metrics": {
    "totalAlerts": 12,
    "criticalAlerts": 2,
    "openAlerts": 5,
    "activeConsents": 245,
    "blockedAttempts": 8,
    "totalAuditLogs": 3456
  },
  "alerts": {
    "high": 5,
    "medium": 3,
    "low": 4
  }
}

RELATÓRIO DETALHADO:
GET /api/compliance/report?startDate=2025-01-01&endDate=2025-01-31
GET /api/compliance/report?startDate=2025-01-01&endDate=2025-01-31&format=csv
Headers: Authorization: Bearer <token>

LISTANDO ALERTAS:
GET /api/compliance/alerts
GET /api/compliance/alerts?severity=critical
GET /api/compliance/alerts?type=CONSENT_BLOCKED
Headers: Authorization: Bearer <token>

RECONHECER UM ALERTA:
POST /api/compliance/alerts/:id/acknowledge
Headers: Authorization: Bearer <token>

RESOLVER UM ALERTA:
POST /api/compliance/alerts/:id/resolve
Body: { "resolution": "Falso positivo - usuario autorizado" }
Headers: Authorization: Bearer <token>

LISTAR ESCOPOS DE CONSENTIMENTO:
GET /api/compliance/scopes
GET /api/compliance/scopes?category=commercial
GET /api/compliance/scopes?highRiskOnly=true
Headers: Authorization: Bearer <token>
*/

// =============================================================================
// PARTE 4: ESTENDENDO COM NOTIFICAÇÕES
// =============================================================================

/*
Para adicionar notificações por email ou Slack no server.js:

const securityAlertsService = require('./src/services/securityAlerts.service');
const nodemailer = require('nodemailer');

// Depois de inicializar securityAlertsService:

// Handler para email
const emailHandler = securityAlertsService.createEmailHandler(
  nodemailer,
  { to: 'admin@bioavanced.com' }
);
securityAlertsService.registerAlertHandler(emailHandler);

// Handler customizado para Slack
const slackHandler = async (alert) => {
  if (['high', 'critical'].includes(alert.severity)) {
    await fetch('https://hooks.slack.com/services/YOUR_WEBHOOK', {
      method: 'POST',
      body: JSON.stringify({
        text: `🚨 ${alert.type}: ${alert.reason}`,
        attachments: [{
          color: alert.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            { title: 'Type', value: alert.type, short: true },
            { title: 'Severity', value: alert.severity, short: true },
            { title: 'Patient', value: alert.patientID, short: true }
          ]
        }]
      })
    });
  }
};
securityAlertsService.registerAlertHandler(slackHandler);
*/

// =============================================================================
// PARTE 5: INTEGRAÇÃO MANUAL EM ROTAS ESPECÍFICAS
// =============================================================================

/*
Se você quer aplicar proteção em uma rota específica APÓS o server estar rodando:

const { integrateSecurityIntoRoute } = require('./src/middleware/integrationSecurityMiddleware');

// Protege a rota de comercialização com escopo comercial
integrateSecurityIntoRoute(app, '/api/samples/:id/commercialize', 'post', {
  consentRequired: true,
  allowedScopes: ['uso_comercial'],
  patientIdResolver: 'patientID',
  alertOnBlock: true
});

// Ou protege com múltiplos escopos
integrateSecurityIntoRoute(app, '/api/samples/share', 'post', {
  consentRequired: true,
  allowedScopes: ['compartilhamento_pesquisadores', 'compartilhamento_internacional'],
  patientIdResolver: 'patientID',
  alertOnBlock: true
});
*/

// =============================================================================
// PARTE 6: USANDO SEGURANÇA EM CONTROLLERS
// =============================================================================

/*
Se você quer adicionar segurança DENTRO de um controller (não apenas middleware):

const securityAlertsService = require('../services/securityAlerts.service');
const { validateScopesForOperation } = require('../config/consentScopes');

async function commercializeController(req, res) {
  try {
    const db = req.app.locals.db;
    const { patientID, operation } = req.body;

    // Valida escopo para operação específica
    const consentValidation = await consentValidator.validateAccess(
      patientID,
      'uso_comercial'
    );

    if (!consentValidation) {
      securityAlertsService.init(db);
      await securityAlertsService.alertConsentBlocked(
        patientID,
        'commercial_operation',
        'INSUFFICIENT_SCOPE',
        req.ip,
        req.get('user-agent')
      );

      return res.status(403).json({
        success: false,
        error: 'Escopo insuficiente para esta operação comercial'
      });
    }

    // Processa operação...
  } catch (error) {
    // ...
  }
}
*/

// =============================================================================
// PARTE 7: MÉTRICAS E MONITORAMENTO
// =============================================================================

/*

ENTENDER O SCORE DE CONFORMIDADE:
- Começa em 100 pontos
- -5 por alerta crítico
- -2 por alerta aberto
- +5 se >80% consentimentos ativos
- -1 por tentativa bloqueada (acima de 10)

Score 90-100: ✅ Excelente conformidade
Score 70-89:  ⚠️  Bom, mas com pontos de atenção
Score 50-69:  🔴 Muitos problemas de conformidade
Score <50:    🚨 Crítico - ação imediata necessária

TIPOS DE ALERTAS GERADOS:
- CONSENT_BLOCKED: Acesso bloqueado sem consentimento
- REVOKED_ACCESS: Acesso bloqueado porque consentimento foi revogado
- SUSPICIOUS_ACTIVITY: Múltiplas tentativas de acesso em curto período
- PII_EXPOSURE: Possível vazamento de dados sensíveis
- SECURITY_BYPASS_ATTEMPT: Tentativa de contornar mecanismo de segurança
- INSUFFICIENT_SCOPE: Falta de escopo específico

ESCOPOS DE CONSENTIMENTO DISPONÍVEIS:
- uso_pesquisa: Pesquisa científica
- uso_comercial: Uso comercial (alto risco)
- compartilhamento_pesquisadores: Compartilhar com pesquisadores
- compartilhamento_internacional: Compartilhar internacionalmente (alto risco)
- analise_genetica: Análise genética (alto risco, indefinido em retenção)
- dados_geneticos_familia: Compartilhar achados com família
- achados_incidentais: Reportar achados incidentais
- recontato_paciente: Entrar em contato com paciente
- uso_secundario_dados: Análises secundárias não planejadas
- material_educacional: Usar em materiais educacionais
- amostra_controle: Usar como controle laboratorial
*/

// =============================================================================
// PARTE 8: BOAS PRÁTICAS
// =============================================================================

/*

1. SEMPRE inicialize o sistema após conectar ao DB
   ✅ correto: await initializeSecuritySystem(app, db);
   ❌ incorreto: não chamar após conectar

2. RESPEITE OS ESCOPOS
   Use os escopos definidos em consentScopes.js
   Não crie escopos customizados sem documentação

3. MONITORE ALERTAS CRÍTICOS
   Configure notificações para alertas alta/crítica
   Resolva alertas regularmente

4. USE DASHBOARDS REGULARMENTE
   Revise métricas de conformidade mensalmente
   Busque padrões de problemas

5. DOCUMENTE RESOLUÇÕES
   Ao resolver alertas, inclua motivo detalhado
   Mantém trilha de auditoria clara

6. TESTE O SISTEMA
   Execute npm run test:unit
   Valide bloqueios em dev antes de produção

7. PARA PII PROTECTION
   Não inclua dados sensíveis em URLs
   Sempre use Body/Post para dados sensíveis
   Sistema sanitiza automaticamente inputs
*/

// =============================================================================
// PARTE 9: TROUBLESHOOTING
// =============================================================================

/*

PROBLEMA: "authConsent not initialized"
SOLUÇÃO: Certifique que initializeSecuritySystem foi chamado após conectar DB

PROBLEMA: Alertas não estão sendo gerados
SOLUÇÃO: Verifique se securityAlertsService.init(db) foi chamado

PROBLEMA: Score de conformidade sempre 100
SOLUÇÃO: Pode significar que não há alertas - revise se bloqueios estão funcionando

PROBLEMA: Relatórios vazios
SOLUÇÃO: Certifique que há dados no período solicitado

PROBLEMA: Middleware não está sendo aplicado
SOLUÇÃO: Verifique se as rotas estão registradas APÓS initializeSecuritySystem
*/

module.exports = {
  documentation: 'Security and Compliance Integration Guide'
};
