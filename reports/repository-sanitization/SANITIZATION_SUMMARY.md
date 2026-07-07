# Sanitization Summary

Resumo da primeira passagem:

- o baseline foi levantado;
- o inventário foi lido;
- os `.last-run.json` rastreados e a chave ACME foram removidos do tracking local;
- o `data-dump.json` também foi removido do tracking local;
- `api/backend/config/env.js`, `src/main.tsx` e `frontend/src/pages/ConsentPage.tsx` foram removidos após migração e confirmação de consumidores;
- o bloco `ASSISTANT_LLM_*` foi removido de `api/backend/src/config/env.js` por não ter consumidores ativos encontrados;
- foram identificados wrappers de compatibilidade claros e pontos de entrada canônicos no frontend/backend;
- a maior parte das decisões ainda está em `DEFERIR` até a prova de consumidor e de migração.

Estado atual:

- auditoria iniciada;
- sanitização ainda não concluída;
- próxima fase depende de mapear consumidores, rotas, jobs e testes.
