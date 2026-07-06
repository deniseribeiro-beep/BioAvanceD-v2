# Matriz Unica de Decisoes - Fase 0

## Referencia

- Branch de referencia: `audit/intake-governance-i18n-orpha`
- SHA de referencia: `d978f59dfa24a64349242eb4516f8d5be5b1b40e`
- Instante de congelamento: `2026-07-06T12:02:35.9260071-03:00`

## Decisoes

| Tema | Decisao | Status |
|---|---|---|
| Snapshot de referencia | Registrar branch, SHA, status do git e horario exato. | aprovado |
| Pasta historica | Usar `docs/inventory/archive/freeze-2026-07-06-d978f59/`. | aprovado |
| Relatorios congelados | Copiar os relatórios vigentes listados no snapshot. | aprovado |
| Inventario atualizado | Manter inventario centrado em `seed`, `seeder`, `bootstrap`, `fixtures`, `legacy`, `aliases`, `wrappers` e configuracoes duplicadas. | aprovado |
| Matriz canonica | Usar este arquivo como versao unica e evitar tabelas concorrentes. | aprovado |
| Reescrita posterior | Qualquer alteracao futura exige novo snapshot com novo SHA de referencia. | aprovado |

## Inclusao no snapshot

- documentos de inventario e congelamento;
- relatorios INPI ativos;
- copias historicas;
- status do git no momento da captura.

## Fora do snapshot

- correcoes futuras ainda nao aprovadas;
- qualquer limpeza adicional apos o congelamento;
- segredos, caches, artefatos gerados e dependencias vendorizadas.

## Referencia historica apenas

- arquivos copiados para `archive/freeze-2026-07-06-d978f59/`;
- o `git status --short` de `2026-07-06T12:02:35.9260071-03:00`.

