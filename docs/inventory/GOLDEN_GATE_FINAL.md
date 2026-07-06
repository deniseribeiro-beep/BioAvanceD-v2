# Gate Final - Padrão Ouro

## Objetivo

O branch só pode ser considerado padrão ouro quando todos os itens abaixo estiverem em `PASS`, com evidência associada e sem dependência permanente de smoke tests.

## Matriz

| Item | Status | Evidência esperada |
|---|---|---|
| Seeds removidos | PENDENTE | Inventário de seeds zerado ou justificado |
| Build raiz | PENDENTE | Saída do build raiz |
| Build frontend | PENDENTE | Saída do build do frontend |
| Validação backend | PENDENTE | Lint/typecheck/execução backend |
| Lint | PENDENTE | Relatório de lint |
| Typecheck completo | PENDENTE | Saída do typecheck raiz |
| Dependências auditadas | PENDENTE | Inventário por workspace |
| Segredos auditados | PENDENTE | Secret scanning / greps críticos |
| Código legado encerrado | PENDENTE | Confirmação de remoção/isolamento |
| Compose dev | PENDENTE | `docker compose config` e subida dev |
| Compose test | PENDENTE | `compose.test.yml` saudável |
| Compose prod | PENDENTE | `compose.prod.yml` saudável |
| Execução limpa | PENDENTE | Stack sem falhas persistentes |
| Backend coverage | PENDENTE | Coverage real backend |
| Frontend coverage | PENDENTE | Coverage real frontend |
| Rotas cobertas | PENDENTE | Suites por rota crítica |
| Páginas cobertas | PENDENTE | Suites por página roteada |
| E2E crítico | PENDENTE | Fluxos reais sem `page.route()` para backend |
| TSA/witness | PENDENTE | Validação de indisponibilidade e operação |
| CI oficial | PENDENTE | Workflow oficial e artefatos |
| Imagem de produção | PENDENTE | Build sem cache, digest e SBOM |
| Backup/restore | PENDENTE | Evidência de backup e restore |
| Documentação | PENDENTE | Docs canônicos atualizados |

## Regra de aceite

- `PASS` exige execução real e evidência rastreável.
- `WARN`, `PARTIAL` e `PENDENTE` não liberam o branch.
- Smoke test só pode existir como validação transitória, nunca como dependência permanente do gate.
