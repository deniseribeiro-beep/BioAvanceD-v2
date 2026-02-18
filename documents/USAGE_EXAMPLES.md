/**
 * EXEMPLOS DE USO PRÁTICO
 * Como testar e usar o sistema de bloqueio ético em produção
 */

// =============================================================================
// EXEMPLO 1: TESTANDO O BLOQUEIO SEM CONSENTIMENTO
// =============================================================================

/*
CURL para testar bloqueio de consentimento:

curl -X POST http://localhost:3000/api/samples \
  -H "Authorization: Bearer seu_token_jwt" \
  -H "Content-Type: application/json" \
  -d '{
    "patientID": "patient-sem-consentimento",
    "sampleType": "BLOOD",
    "location": "Lab A"
  }'

RESPOSTA ESPERADA (403):
{
  "success": false,
  "error": "🔒 BLOQUEIO ÉTICO: Consentimento ausente",
  "code": "CONSENT_REQUIRED",
  "message": "Operação não permitida. O paciente não possui consentimento ativo para esta operação.",
  "timestamp": "2026-02-12T18:50:00.000Z"
}

Um alerta é registrado automaticamente:
- Type: CONSENT_BLOCKED
- Severity: high
- PatientID: patient-sem-consentimento
*/

// =============================================================================
// EXEMPLO 2: DASHBAORD DE CONFORMIDADE
// =============================================================================

/*
Acessar dashboard:

curl http://localhost:3000/api/compliance/dashboard?days=30 \
  -H "Authorization: Bearer seu_token_jwt"

RESPOSTA:
{
  "success": true,
  "data": {
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
    },
    "topIssues": [
      {
        "priority": "high",
        "title": "Muitos alertas críticos",
        "description": "2 alertas críticos foram detectados. Investigação imediata recomendada.",
        "action": "Revisar logs e alertas de segurança"
      }
    ]
  }
}

Interpretação:
- Score 85: Boa conformidade, mas com pontos de atenção
- 2 alertas críticos: Revisão necessária
- 245 consentimentos ativos: 98% de taxa
*/

// =============================================================================
// EXEMPLO 3: VISUALIZAR ALERTAS ABERTOS
// =============================================================================

/*
Listar todos os alertas:

curl http://localhost:3000/api/compliance/alerts \
  -H "Authorization: Bearer seu_token_jwt"

Filtrar por severidade crítica:

curl http://localhost:3000/api/compliance/alerts?severity=critical \
  -H "Authorization: Bearer seu_token_jwt"

Filtrar por tipo:

curl "http://localhost:3000/api/compliance/alerts?type=SUSPICIOUS_ACTIVITY" \
  -H "Authorization: Bearer seu_token_jwt"

RESPOSTA:
{
  "success": true,
  "total": 2,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "type": "SUSPICIOUS_ACTIVITY",
      "severity": "critical",
      "patientID": "patient-123",
      "userID": "user-456",
      "action": "MULTIPLE_FAILED_ATTEMPTS",
      "reason": "Múltiplas tentativas de acesso negado (5) em curto período",
      "details": {
        "attemptCount": 5,
        "attempts": [
          {
            "timestamp": "2026-02-12T18:45:00Z",
            "reason": "CONSENT_REQUIRED"
          },
          ...
        ],
        "timeWindow": "5 minutos"
      },
      "sourceIP": "192.168.1.100",
      "timestamp": "2026-02-12T18:45:30Z",
      "status": "open",
      "acknowledged": false
    },
    ...
  ]
}
*/

// =============================================================================
// EXEMPLO 4: RECONHECER E RESOLVER ALERTAS
// =============================================================================

/*
Reconhecer um alerta (marcar como lido):

curl -X POST http://localhost:3000/api/compliance/alerts/507f1f77bcf86cd799439011/acknowledge \
  -H "Authorization: Bearer seu_token_jwt"

RESPOSTA:
{
  "success": true,
  "message": "Alerta reconhecido"
}

Resolver um alerta (fechar como resolvido):

curl -X POST http://localhost:3000/api/compliance/alerts/507f1f77bcf86cd799439011/resolve \
  -H "Authorization: Bearer seu_token_jwt" \
  -H "Content-Type: application/json" \
  -d '{
    "resolution": "Falso positivo - usuário é pesquisador autorizado"
  }'

RESPOSTA:
{
  "success": true,
  "message": "Alerta resolvido"
}

O alerta agora mostra:
- status: "resolved"
- resolution: "Falso positivo..."
- resolvedBy: "admin-user-id"
- resolvedAt: "2026-02-12T18:55:00Z"
*/

// =============================================================================
// EXEMPLO 5: RELATÓRIO DETALHADO
// =============================================================================

/*
Gerar relatório de um período:

curl "http://localhost:3000/api/compliance/report?startDate=2025-12-01&endDate=2025-12-31" \
  -H "Authorization: Bearer seu_token_jwt"

RESPOSTA (parcial):
{
  "success": true,
  "data": {
    "period": {
      "start": "2025-12-01",
      "end": "2025-12-31",
      "generatedAt": "2026-02-12T18:55:00Z"
    },
    "summary": {
      "complianceScore": 78,
      "totalAlerts": 45,
      "blockedAttempts": 23,
      "activeConsents": 312
    },
    "alerts": {
      "total": 45,
      "critical": 3,
      "open": 12,
      "resolved": 33,
      "byType": {
        "CONSENT_BLOCKED": 28,
        "SUSPICIOUS_ACTIVITY": 10,
        "PII_EXPOSURE": 2,
        "REVOKED_ACCESS": 5
      }
    },
    "consentMetrics": {
      "total": 345,
      "active": 312,
      "revoked": 33,
      "activePercentage": "90.43",
      "revokedPercentage": "9.57"
    },
    "blockedAttempts": {
      "total": 23,
      "byReason": {
        "CONSENT_REQUIRED": 18,
        "INSUFFICIENT_SCOPE": 4,
        "CONSENT_REVOKED": 1
      }
    },
    "recommendations": [
      {
        "priority": "medium",
        "title": "Escopo de consentimento insuficiente",
        "description": "4 tentativas foram bloqueadas por escopo insuficiente.",
        "action": "Revisar políticas de consentimento com pesquisadores"
      },
      {
        "priority": "low",
        "title": "Conformidade em dia",
        "description": "Taxa de consentimento em 90% indica boa conformidade.",
        "action": "Manter monitoramento regular"
      }
    ]
  }
}

Exportar como CSV:

curl "http://localhost:3000/api/compliance/report?startDate=2025-12-01&endDate=2025-12-31&format=csv" \
  -H "Authorization: Bearer seu_token_jwt" \
  --output compliance_report.csv

*/

// =============================================================================
// EXEMPLO 6: ESCOPOS DE CONSENTIMENTO
// =============================================================================

/*
Ver todos os escopos:

curl http://localhost:3000/api/compliance/scopes \
  -H "Authorization: Bearer seu_token_jwt"

RESPOSTA:
{
  "success": true,
  "data": [
    {
      "key": "uso_pesquisa",
      "label": "Pesquisa Científica",
      "description": "Permitir uso de dados e amostras biológicas em pesquisas científicas",
      "category": "research",
      "riskLevel": "low",
      "retention": 1825,
      "requiredFor": ["analise", "extraction", "sequenciamento"]
    },
    {
      "key": "uso_comercial",
      "label": "Uso Comercial",
      "description": "Permitir uso de amostras para fins comerciais",
      "category": "commercial",
      "riskLevel": "high",
      "retention": 2555,
      "requiredFor": ["comercializacao", "patente", "desenvolvimento_produto"]
    },
    ...
  ]
}

Filtrar apenas escopos de alto risco:

curl "http://localhost:3000/api/compliance/scopes?highRiskOnly=true" \
  -H "Authorization: Bearer seu_token_jwt"

Filtrar por categoria:

curl "http://localhost:3000/api/compliance/scopes?category=commercial" \
  -H "Authorization: Bearer seu_token_jwt"

curl "http://localhost:3000/api/compliance/scopes?category=genetic" \
  -H "Authorization: Bearer seu_token_jwt"
*/

// =============================================================================
// EXEMPLO 7: MONTANDO FLUXO COMPLETO DE TESTE
// =============================================================================

/*

#!/bin/bash
# Salve como: test-security-flow.sh

TOKEN="seu_token_jwt_aqui"
API="http://localhost:3000/api"

echo "🔍 1. Verificando dashboard de conformidade..."
curl -s "$API/compliance/dashboard?days=7" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.complianceScore'

echo "⚠️ 2. Listando alertas críticos..."
curl -s "$API/compliance/alerts?severity=critical" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

echo "🧪 3. Testando bloqueio sem consentimento..."
curl -s -X POST "$API/samples" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "patientID": "test-no-consent",
    "sampleType": "BLOOD",
    "location": "Lab"
  }' | jq '.code'

echo "✅ 4. Verificando novo alerta gerado..."
curl -s "$API/compliance/alerts?status=open" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

echo "📊 5. Gerando relatório mensal..."
curl -s "$API/compliance/report?startDate=2026-01-01&endDate=2026-01-31" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary'

echo "🎯 Teste completo!"
*/

// =============================================================================
// EXEMPLO 8: USANDO EM SCRIPTS DE PRODUÇÃO
// =============================================================================

/*

// Node.js script para monitorar conformidade

const fetch = require('node-fetch');

async function checkComplianceHealthy(token) {
  const response = await fetch('http://localhost:3000/api/compliance/dashboard?days=1', {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await response.json();
  const { complianceScore, metrics } = data.data;

  console.log(`📊 Score de Conformidade: ${complianceScore}/100`);
  console.log(`🚨 Alertas Críticos: ${metrics.criticalAlerts}`);
  console.log(`❌ Tentativas Bloqueadas: ${metrics.blockedAttempts}`);

  if (complianceScore < 70) {
    // Enviar notificação
    console.error('⚠️ ALERTA: Conformidade abaixo do esperado!');
    // ... enviar email, Slack, etc
  }

  return complianceScore;
}

checkComplianceHealthy(process.env.JWT_TOKEN);
*/

// =============================================================================
// MONITORAMENTO EM TEMPO REAL
// =============================================================================

/*
Para monitorar em tempo real, adicione ao seu frontend/dashboard:

const interval = setInterval(async () => {
  const res = await fetch('/api/compliance/dashboard?days=1', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { data } = await res.json();

  // Atualizar UI com:
  // - Compliance Score (gráfico)
  // - Alertas críticos (notificação)
  // - Bloqueios (contador)
  // - Consentimentos (percentual)

  if (data.metrics.criticalAlerts > 0) {
    showNotification(`⚠️ ${data.metrics.criticalAlerts} alertas críticos!`);
  }
}, 60000); // A cada minuto
*/

module.exports = {
  examples: 'Exemplos de uso do sistema de segurança'
};
