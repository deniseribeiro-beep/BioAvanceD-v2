# MANUAL_VERIFY — recheck 2026-11-05

Homolog `http://127.0.0.1:8080` (VM `instance-20261029-155615`, túnel SSH local; IAP direto na porta 8080 continua 4033). Login `admin` / stack de teste.

Regra deste pass: código só muda se o critério falhar. O único FAIL de layout já estava corrigido no commit `806453df` e não estava no bundle publicado. O frontend foi reconstruído na VM e reverificado.

## Resultado

| ID | Resultado | O que foi visto |
|----|-----------|-----------------|
| SKIP-001 | PASS | Organização e coleção: `/new` é página, salvar volta à aba, a linha aparece. Registros de fumaça apagados. |
| SKIP-002 | PASS | `/collections/:id/governance` abre com `collection-governance-panel`. Voltar recarrega a lista. O spec Playwright também registrou aprovação, contexto e suspensão. |
| SKIP-003 | PASS | Equipamento, sensor e política: criar, voltar à aba, editar e apagar. |
| SKIP-004 | PASS | Descrição de qualidade, modelo de relatório e associação de biomarcador: criar, voltar à lista e editar. Biomarcador não tem exclusão na UI; o registro de fumaça foi removido pela API. |
| SKIP-005 | PASS | Edição real de organização, coleção, equipamento, sensor, política, qualidade, modelo e biomarcador. Regime de coleção já definido permanece bloqueado. |
| SKIP-006 | PASS | Busca de organização, coleção, equipamento, sensor e política filtra e mostra o estado vazio. |
| SKIP-007 | Fora deste pass | `e2e-gate.sh` não foi executado, por decisão. Os dois specs pedidos rodaram contra `:8080` e passaram. |
| SKIP-008 | PASS | As páginas `/new` de organização, coleção, facility, qualidade, modelo e biomarcador abrem com Voltar, sem modal. |
| SKIP-009 | PASS, com notas | 51 rotas do ui-gold que não são form page nova. Nenhuma com layout colapsado. H1 duplicado só em Segurança; corrigido no bundle e reverificado (um `h1`: "Gerenciamento do Sistema"). |
| SKIP-010 | PASS | Esqueci a senha, envio de arquivo e restaurar backup abrem modal e a URL não muda. Confirmações curtas de exclusão continuam `confirm()` na própria lista. "Imprimir Etiquetas" abre a página `/samples/:id/label`, que já era rota do ui-gold. |

## Notas de rotas sem dado real (SKIP-009)

Não são defeito de layout. Não foi inventado fluxo para elas.

- `/samples/demo-id`, `/samples/demo-id/label`, `/logs/demo-id`: a página abre e não há amostra ou log com esse id.
- `/reports/demo-id`: título "Erro".
- `/admin/tcle/edit/demo-template`: redireciona para `/admin/tcle/new`.
- `/patient/e-consent/demo-token` e `/patient/e-consent/import/demo-token`: "Link inválido ou expirado."
- `/patients/demo-id/consent`: link incompleto.

## Playwright contra `:8080`

- `organization-collection-management-ui.spec.ts`: 2 passed
- `collection-governance-ui.spec.ts`: 1 passed, com `E2E_MONGO_URI` no Mongo publicado da VM (`127.0.0.1:27017`)

## Efeito colateral

Foi criado um backup em 2026-11-05 (cerca de 145 MB) só para abrir o modal de restauração. A restauração não foi confirmada.
