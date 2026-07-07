# Dependency Audit

Estado inicial:

- ainda não rodei `npm ls`, `depcheck`, `knip` ou equivalentes;
- as dependências relevantes já aparecem nos `package.json` de raiz, backend e frontend;
- há sobreposição intencional entre runtime e teste em algumas áreas.

Pontos de atenção:

- `vitest`, `supertest`, `playwright` e `@playwright/test` precisam ser auditados por pacote;
- `winston`, `mongoose`, `neo4j-driver`, `ioredis`, `mqtt` e `@influxdata/influxdb-client` parecem runtime legítimos;
- nenhuma dependência foi removida nesta passagem.

Decisão atual:

- `DEFERIR` para análise de órfãos e duplicatas;
- sem prova suficiente para declarar dependência não usada.
