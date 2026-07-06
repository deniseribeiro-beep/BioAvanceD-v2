# Auditoria real de dependências - Fase 5

Data de captura: 2026-07-06

Escopo:
- raiz
- `api/backend`
- `frontend`

Ferramentas executadas:
- `npm ls --all --json`
- `npm --prefix api/backend ls --depth=0 --json`
- `npm --prefix frontend ls --depth=0 --json`
- `depcheck`
- `knip`

## Leitura executiva

- A raiz não atua como aplicativo runtime próprio; ela delega para `api/backend` e `frontend`.
- O backend ainda carrega dependências de teste em runtime package.json.
- O frontend está mais próximo do contrato esperado, mas ainda tem um gap de `vite-plugin-istanbul` na árvore efetiva analisada.
- Existem versões divergentes entre raiz, backend e frontend para pacotes compartilhados.
- O backend tem um conflito real de peer dependency entre `bullmq` e `redis`.

## Raiz

### Status

- `RUNTIME`: nenhum pacote runtime próprio declarado.
- `DEV`: apenas tooling da raiz.
- `TEST`: nenhum pacote de teste runtime próprio declarado.
- `REMOVER`: nenhum pacote isolado a remover por uso direto, porque a raiz só orquestra workspaces.
- `INVESTIGAR`: os scripts da raiz pressupõem os workspaces já instalados e não um app único na raiz.

### Observações

- `build`, `test`, `lint` e `typecheck` delegam corretamente para `api/backend` e `frontend`.
- `npm ls` na raiz não é uma base confiável para dependências do produto porque o workspace real está dividido.

## `api/backend`

### RUNTIME

- `@influxdata/influxdb-client`
- `ajv`
- `ajv-formats`
- `argon2`
- `bcryptjs`
- `bullmq`
- `bwip-js`
- `cors`
- `crypto-js`
- `csv-parser`
- `csv-stringify`
- `dotenv`
- `exceljs`
- `express`
- `express-rate-limit`
- `express-validator`
- `fast-xml-parser`
- `helmet`
- `ioredis`
- `jsonwebtoken`
- `mongodb`
- `mongoose`
- `mqtt`
- `multer`
- `neo4j-driver`
- `node-cron`
- `qrcode`
- `redis`
- `resend`
- `socket.io`
- `socket.io-client`
- `speakeasy`
- `uuid`
- `yauzl`

### DEV

- `nodemon`
- `vitest`

### TEST

- `supertest`
- `@vitest/browser`

### REMOVER

- `@vitest/browser` do backend package.json, porque é dependência de teste e não runtime.
- `supertest` do backend package.json, porque é dependência de teste e não runtime.
- `nodemon` já está corretamente restrito a desenvolvimento, mas os scripts `dev` e `worker:dev` ainda dependem dele e devem permanecer só se o fluxo local continuar usando Nodemon.

### INVESTIGAR

- `redis` está em conflito com `bullmq` no `npm ls`: a árvore instalada mostra `redis@4.7.1`, enquanto `bullmq` pede `>=5.0.0`.
- `winston` aparece usado em código e no inventário, mas o `depcheck` backend o relatou como ausente. Isso merece checagem da instalação e do lock do workspace.
- `node-fetch` e `xml2js` aparecem como usados por scripts do backend, mas o `depcheck` backend também os relatou como ausentes.
- `@vitest/browser` em produção é um forte sinal de pacote de teste vazando para runtime.
- Há vários scripts de seed/import ainda presentes no backend; nem todos são seed, mas vários merecem classificação separada para não virar dependência fantasma.

## `frontend`

### RUNTIME

- `axios`
- `date-fns`
- `lucide-react`
- `papaparse`
- `qrcode`
- `react`
- `react-barcode`
- `react-datamatrix-svg`
- `react-dom`
- `react-router-dom`
- `react-signature-canvas`
- `socket.io-client`
- `winston`
- `xlsx`
- `zod`

### DEV

- `@testing-library/jest-dom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@types/node`
- `@types/papaparse`
- `@types/qrcode`
- `@types/react`
- `@types/react-dom`
- `@vitejs/plugin-react`
- `@vitest/coverage-v8`
- `autoprefixer`
- `jsdom`
- `postcss`
- `rollup`
- `typescript`
- `vite`
- `vitest`

### TEST

- `@playwright/test`

### REMOVER

- Nenhum pacote claramente removível só pela auditoria atual.

### INVESTIGAR

- `vite-plugin-istanbul` aparece usado em `frontend/vite.config.js`, mas não ficou resolvido na árvore efetiva que o `depcheck` analisou.
- Há versões divergentes entre raiz e frontend para `axios`, `react-router-dom`, `lucide-react` e `zod`.
- `winston` está em runtime do frontend, mas precisa ser confirmado se é realmente usado em produção ou apenas em logging de utilitários.

## Pacotes duplicados com versões diferentes

- `axios`
  - raiz: `^1.15.1`
  - frontend: `^1.13.5`
- `lucide-react`
  - raiz: `^1.8.0`
  - frontend: `^0.294.0`
- `react-router-dom`
  - raiz: `^7.14.1`
  - frontend: `^6.20.0`
- `zod`
  - raiz: `^4.3.6`
  - frontend: `^3.25.76`
- `vitest`
  - raiz: `^4.0.7`
  - backend: `^4.0.7` no manifest, árvore instalada em `4.1.9`
  - frontend: `^4.0.7`
- `@vitest/coverage-v8`
  - raiz: `^4.1.2`
  - frontend: `^4.1.2`
  - árvore instalada em `4.1.9`

## Pacotes de teste instalados em produção

- `api/backend`
  - `@vitest/browser`
  - `supertest`

## Dependências não declaradas / importações sem pacote

- `api/backend`
  - `winston` foi relatado como ausente pelo `depcheck`, apesar de existir no manifest.
- `node-fetch` foi relatado como ausente pelo `depcheck` em uma revisão anterior do importador histórico `import-hpo.js`.
- `xml2js` foi relatado como ausente pelo `depcheck` em uma revisão anterior do importador histórico `import-orphanet.js`.
- `frontend`
  - `vite-plugin-istanbul` foi relatado como ausente pelo `depcheck`, usado em `frontend/vite.config.js`.

## Versões incompatíveis de Playwright/Vitest

- `Playwright`
  - frontend usa `@playwright/test@1.58.2`
  - não apareceu conflito direto de versão entre workspaces, mas a árvore precisa ser mantida única dentro do frontend.
- `Vitest`
  - root/backend/frontend convergem no major `4`, mas a árvore instalada do backend/frontend está em `4.1.9` enquanto o manifest ainda fala `^4.0.7`.
  - isso não quebra por si só, mas é drift entre lock e manifesto.

## Conclusão

O inventário real mostra três frentes:

1. A raiz já está delegando, não competindo como app.
2. O backend ainda precisa higienizar dependências de teste e reconciliar o par `bullmq`/`redis`.
3. O frontend está razoavelmente coeso, mas precisa confirmar `vite-plugin-istanbul` e reduzir drift de versões compartilhadas.

### Importadores removidos

Os scripts `import-hpo.js` e `import-orphanet.js` foram removidos do caminho ativo. Não existem comandos, agendamentos ou consumidores de runtime associados a esses importadores no estado atual do branch.

## Próximo corte sugerido

- mover `@vitest/browser` e `supertest` para a categoria de teste no backend;
- reconciliar `bullmq` com `redis@>=5`;
- decidir se `winston` fica como runtime real no frontend;
- revisar o uso real de `vite-plugin-istanbul` no frontend antes de removê-lo ou fixá-lo.
