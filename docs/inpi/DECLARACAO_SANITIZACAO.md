# Declaracao de Sanitizacao - BioAvanceD v1.1.0

## Declaracao

O pacote oficial do BioAvanceD v1.1.0 para novo congelamento INPI deve ser sanitizado antes da geracao do ZIP por `git archive`. O motor metodologico preservado e RCS-GOV 1.0.

## Exclusoes obrigatorias

Nao entram no pacote:

- `.git`;
- `node_modules`;
- `dist`;
- `build`;
- `coverage`;
- `playwright-report`;
- `test-results`;
- `.env`;
- `.env.docker` real;
- logs;
- uploads;
- backups;
- dumps;
- tokens;
- chaves;
- secrets;
- senhas;
- API keys;
- URIs reais de banco;
- dados reais de pacientes;
- dados reais de amostras;
- dados reais de usuarios;
- caches e arquivos temporarios locais.

## Itens preservados

Devem permanecer:

- codigo-fonte versionado;
- frontend;
- backend;
- documentacao tecnica;
- scripts versionados;
- testes versionados;
- Docker Compose e exemplos de ambiente sem segredos;
- RCS-GOV 1.0;
- seeds S1/S2/S3;
- pesos, thresholds e regras de governanca;
- Merkle/integridade e auditoria.

## Confirmacao

O pacote oficial sera gerado por `git archive`, a partir da tag futura `v1.1.0-inpi-rcs-gov`. Nao ha dados reais de pacientes no pacote documental. Segredos e arquivos reais de ambiente devem permanecer fora do repositorio e fora do ZIP.
