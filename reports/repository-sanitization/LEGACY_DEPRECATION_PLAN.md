# Legacy Deprecation Plan

Situação inicial:

- não houve remoção de legado nesta passagem;
- foram confirmados wrappers e aliases finos que servem a compatibilidade.

Candidatos a revisar:

- `api/backend/src/interface/routes/patient-consent-legacy.routes.js`
- `legacyStatus` em `api/backend/src/models/Sample.js`
- mapeamentos legados em sincronização FHIR e importação
- `LegacySampleStatus` no frontend

Plano:

1. mapear consumidores reais;
2. identificar contratos que ainda dependem do caminho legado;
3. manter wrapper fino quando houver dependência funcional;
4. só remover depois de migração e teste de regressão.

Decisão atual:

- `DEFERIR` para remoção de legado ainda não tratado;
- wrappers já removidos nesta rodada foram migrados e eliminados do caminho ativo.
