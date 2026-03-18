# TLS Production Cutover Checklist (P1-7)

Data: 2026-03-18  
Escopo: ativação de TLS 1.3-only no Nginx Proxy Manager, com validação técnica e plano de rollback.

## 1) Pré-cutover (T-1)

- Confirmar janela de mudança aprovada e responsáveis de plantão.
- Confirmar backup dos arquivos:
  - `infra/nginx/npm/custom/http_top.conf`
  - `infra/nginx/npm/custom/http_top.prod.conf`
- Confirmar certificados válidos (cadeia completa e chave privada correspondente).
- Confirmar que ambiente de desenvolvimento permanece em perfil compatível (TLSv1.2 + TLSv1.3).
- Validar que clientes/sistemas críticos suportam TLS 1.3.

Critério de saída:
- Todos os itens acima concluídos e registrados.

## 2) Execução do cutover (T0)

1. Ativar perfil de produção:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\activate-prod-tls.ps1`
2. Reiniciar/recarregar Nginx Proxy Manager.
3. Validar protocolo negociado:
   - handshake externo deve negociar TLS 1.3
   - TLS 1.2 deve ser recusado
   - validação assistida (PowerShell):
     - `powershell -ExecutionPolicy Bypass -File .\scripts\validate-tls-cutover.ps1 -BaseUrl https://SEU_DOMINIO`
4. Validar rotas críticas:
   - API: `/api/health`
   - WebSocket: `/socket.io/`
   - Frontend principal

Critério de saída:
- Tráfego funcional e apenas TLS 1.3 aceito no endpoint público.

## 3) Validação pós-cutover (T+30 min)

- Testar login, criação de paciente e cadastro/movimentação de amostra.
- Testar integrações de telemetria e endpoints de importação/exportação críticos.
- Monitorar erros 4xx/5xx e latência no Nginx/backend por pelo menos 30 minutos.
- Confirmar ausência de queda em integrações externas.

Critério de saída:
- Erros e latência dentro do baseline esperado; sem incidentes críticos.

## 4) Rollback (se necessário)

1. Reverter para perfil compatível de desenvolvimento/contingência:
   - `powershell -ExecutionPolicy Bypass -File .\scripts\activate-dev-tls.ps1`
2. Reiniciar/recarregar Nginx Proxy Manager.
3. Validar retomada dos fluxos e estabilidade operacional.
4. Abrir post-mortem com causa raiz e plano de correção antes de novo cutover.

## 5) Evidências para auditoria

- Capturas/logs do handshake TLS (antes/depois).
- Registro da janela de mudança e aprovadores.
- Registro de execução dos scripts de ativação.
- Resultado dos testes funcionais pós-cutover.
- Registro de rollback (se aplicado).

## 6) Status de implementação

- Preparação técnica: concluída.
- Ativação em produção: pendente de migração.
- Fechamento P1-7: condicionado à execução do cutover e validação operacional.
