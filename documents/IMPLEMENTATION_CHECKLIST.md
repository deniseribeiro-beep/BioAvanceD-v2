/**
 * IMPLEMENTAÇÃO NO SERVER.JS
 * 
 * Este arquivo mostra EXATAMENTE o que adicionar no server.js
 * para ativar o sistema de segurança e conformidade.
 * 
 * Basta copiar e colar os trechos nos pontos indicados!
 */

// =======================
// ADICIONE ISTO NO INÍCIO DO server.js (após outros requires):
// =======================

const { initializeSecuritySystem } = require('./src/middleware/integrationSecurityMiddleware');

// =======================
// ADICIONE ISTO NA SEÇÃO DE ROTAS (junto com as outras rotas):
// =======================

// ⭐ NOVA ROTA DE CONFORMIDADE
app.use("/api/compliance", require("./src/routes/compliance.routes")); // ← ADICIONE ESTA LINHA

// =======================
// ADICIONE ISTO NA FUNÇÃO startServer(), APÓS conectar ao DB:
// =======================

// Conecta banco
const db = await connectDB();
app.locals.db = db;

// ✅ INICIALIZA SISTEMA DE SEGURANÇA E CONFORMIDADE (novo)
try {
  await initializeSecuritySystem(app, db);
  logger.info('✅ Sistema de segurança e conformidade ativado');
} catch (securityError) {
  logger.error('⚠️ Aviso: Erro ao inicializar sistema de segurança:', securityError.message);
  logger.warn('O sistema continuará rodando, mas sem proteção de consentimento');
}

// =======================
// RESULT: Structure final do startServer():
// =======================

async function startServer() {
  try {
    const PORT = parseInt(process.env.PORT || "3000");
    const actualPort = await portManager.getAvailablePort(PORT);

    logger.info(`🔌 Porta escolhida: ${actualPort}`);

    // Conecta banco
    const db = await connectDB();
    app.locals.db = db;

    // ✅ INICIALIZA SISTEMA DE SEGURANÇA E CONFORMIDADE
    try {
      await initializeSecuritySystem(app, db);
      logger.info('✅ Sistema de segurança e conformidade ativado');
    } catch (securityError) {
      logger.error('⚠️ Aviso: Erro ao inicializar sistema de segurança:', securityError.message);
    }

    // Seed inicial de tipos de análise
    // ... resto do código igual ...
  }
}

// =======================
// CONSUMINDO O SISTEMA
// =======================

/*

1. DEPOIS QUE SERVER ESTÁ RODANDO, ACESSE LOS ENDPOINTS:

   Dashboard de Conformidade:
   GET http://localhost:3000/api/compliance/dashboard?days=30
   Headers: Authorization: Bearer <seu_token_jwt>

   Alertas Abertos:
   GET http://localhost:3000/api/compliance/alerts?severity=critical
   Headers: Authorization: Bearer <seu_token_jwt>

   Relatório Detalhado:
   GET http://localhost:3000/api/compliance/report?startDate=2025-01-01&endDate=2025-01-31
   Headers: Authorization: Bearer <seu_token_jwt>

   Escopos de Consentimento:
   GET http://localhost:3000/api/compliance/scopes
   Headers: Authorization: Bearer <seu_token_jwt>

2. TESTANDO O BLOQUEIO ÉTICO:

   Tente criar uma amostra SEM consentimento válido:
   POST http://localhost:3000/api/samples
   Headers: Authorization: Bearer <seu_token_jwt>
   Body: {
     "patientID": "invalid-patient-without-consent",
     "sampleType": "BLOOD",
     ...
   }

   Resultado esperado:
   403 Forbidden
   {
     "success": false,
     "error": "🔒 BLOQUEIO ÉTICO: Consentimento ausente",
     "code": "CONSENT_REQUIRED"
   }

3. VERIFICANDO ALERTAS:

   GET http://localhost:3000/api/compliance/alerts
   Headers: Authorization: Bearer <seu_token_jwt>

   Você verá o alerta registrado automaticamente!

*/

// =======================
// ARQUIVOS CRIADOS
// =======================

/*

✅ Arquivo de Configuração:
   src/config/consentScopes.js
   - Define todos os escopos de consentimento
   - Funções para validar escopos
   - Mapeamento de operações por escopo

✅ Middleware de Bloqueio Ético:
   src/middleware/authConsent.js
   - Valida consentimento antes de operações
   - Retorna 403 se bloqueado
   - Factory methods para escopos específicos

✅ Middleware de Integração:
   src/middleware/integrationSecurityMiddleware.js
   - Aplica proteção automaticamente
   - Detecta tentativas suspeitas
   - Gera alertas ao bloquear

✅ Service de Alertas:
   src/services/securityAlerts.service.js
   - Registra eventos críticos
   - Detecta atividades suspeitas
   - Suporta handlers customizados

✅ Service de Relatórios:
   src/services/complianceReport.service.js
   - Gera relatórios de conformidade
   - Calcula score de conformidade
   - Exporta em JSON/CSV

✅ Rotas de Conformidade:
   src/routes/compliance.routes.js
   - GET /api/compliance/dashboard
   - GET /api/compliance/report
   - GET /api/compliance/alerts
   - POST /api/compliance/alerts/:id/acknowledge
   - POST /api/compliance/alerts/:id/resolve
   - GET /api/compliance/scopes

✅ Testes Unitários:
   test/unit/security.test.js
   test/unit/authConsent.test.js

✅ Documentação:
   INTEGRATION_GUIDE.md

*/

// =======================
// VERIFICAÇÃO
// =======================

/*

Para verificar se tudo está funcionando:

1. Inicie o servidor:
   npm run dev

2. Busque no console por:
   ✅ "Sistema de segurança e conformidade ativado"
   ✅ "Segurança integrada em N rotas críticas"

3. Teste um bloqueio:
   curl -X POST http://localhost:3000/api/samples \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"patientID":"test","sampleType":"BLOOD"}'

4. Deve retornar 403 com erro de consentimento

5. Verifique alertas:
   curl http://localhost:3000/api/compliance/alerts \
     -H "Authorization: Bearer <token>"

*/

module.exports = {
  implementationGuide: 'Copy and paste the sections above into server.js'
};
