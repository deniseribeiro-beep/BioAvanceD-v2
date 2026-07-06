# Duplication and Canonical Paths

Situação atual:

- `api/backend/config/env.js` é um reexport de compatibilidade para `api/backend/src/config/env.js`;
- `src/main.tsx` é um wrapper de entrada legado que aponta para `frontend/src/App`;
- `frontend/src/main.tsx` é o entry point real do app frontend;
- `frontend/src/pages/ConsentPage.tsx` é um alias fino para `frontend/src/pages/patient/EConsentPage.tsx`;
- `frontend/src/views/ConsentPage.tsx` e `frontend/src/views/NewUserPage.tsx` são implementações de tela reais, com CSS associado;
- `api/backend/tests/run-tests.js` e `api/backend/tests/unit/run-tests.js` são runners distintos, com propósitos diferentes.

Canônico por caminho:

| Par | Caminho canônico | Situação do outro caminho | Decisão |
|---|---|---|---|
| `api/backend/config/env.js` vs `api/backend/src/config/env.js` | `api/backend/src/config/env.js` | wrapper de compatibilidade removido após migração dos consumidores | REMOVIDO |
| `src/main.tsx` vs `frontend/src/main.tsx` | `frontend/src/main.tsx` | wrapper legado removido; entry point real confirmado no frontend | REMOVIDO |
| `frontend/src/pages/ConsentPage.tsx` vs `frontend/src/views/ConsentPage.tsx` | `frontend/src/views/ConsentPage.tsx` para a tela administrativa; `frontend/src/pages/patient/EConsentPage.tsx` para eConsent | alias fino removido; rotas e nomes ficaram explícitos | REMOVIDO |
| `frontend/src/views/ConsentPage.css` e `frontend/src/views/NewUserPage.css` | sem consolidação | ambos são estilos de tela usados | MANTIDO — NECESSÁRIO |
| `api/backend/tests/run-tests.js` vs `api/backend/tests/unit/run-tests.js` | sem consolidação | runners com escopos diferentes | MANTIDO — NECESSÁRIO |

Itens ainda a auditar com mais profundidade:

- duplicidade de configuração Playwright/Vitest entre raiz e subpastas;
- eventuais aliases adicionais de páginas e views;
- duplicação de constantes compartilhadas entre backend, frontend e `shared`.
