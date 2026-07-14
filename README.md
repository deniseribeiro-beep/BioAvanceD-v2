# BioAvanceD

BioAvanceD é uma arquitetura e sistema para biobanco digital, com foco atual em eConsent, governança de consentimento em tempo de execução, rastreabilidade de eventos, interoperabilidade e arquitetura poliglota.

O projeto combina:

- frontend React/Vite;
- backend Node.js;
- MongoDB como fonte operacional principal;
- Neo4j como projeção e linhagem;
- InfluxDB para telemetria;
- Redis para suporte operacional.

## Current Implementation Status

### Active scope

- eConsent e consentimento dinâmico;
- governança de consentimento em runtime;
- IDs canônicos de participante e espécime;
- rastreabilidade e auditoria de eventos;
- current-state CI;
- testes de arquitetura e contrato com `node:test`;
- seed validation essencial e dry-run;
- hardening de auditoria, conformidade e jobs críticos.

### Stabilization

- saneamento do backend por issues pontuais;
- refinamento gradual do modelo canônico;
- endurecimento de auditoria e Merkle;
- validação de terminologias e contratos de fronteira;
- limpeza de superfícies legadas sem restaurar compatibilidade falsa.

### Removed or legacy

- suíte Vitest legada como contrato oficial;
- suíte Playwright legada como contrato oficial;
- aliases antigos como `patientID`, `patientId`, `sampleID` e `sampleId`;
- coleções legadas como contrato de runtime;
- suposições Fabry-specific sobre biomarcadores;
- serviços removidos sem consumidor runtime ativo;
- fallback silencioso para contratos antigos em fluxos já canonicalizados.

### Future scope

- Intelligent Assistant;
- XAI / explicabilidade;
- interpretação avançada assistida por IA de biomarcadores;
- sincronização ampliada de terminologias;
- reconstrução futura de suites unitárias e E2E sobre o contrato estabilizado.

## Architecture

### Runtime layers

- Backend: Node.js/Express.
- Frontend: React/Vite.
- MongoDB: fonte operacional principal.
- Neo4j: projeção e linhagem, alimentada por outbox.
- InfluxDB: telemetria e séries temporais.
- Redis: filas, cache e suporte operacional.
- Worker runtime: `src/workers/worker.js` registra explicitamente o daily Merkle schedule ao iniciar; o módulo do job permanece seguro para importação em testes.

### Boundary rules

- MongoDB continua sendo a fonte de verdade operacional.
- Neo4j não é persistência primária; é projeção.
- FHIR é fronteira de interoperabilidade e serialização, não etapa obrigatória de persistência operacional.
- Outbox e projeções são usados para integração entre domínios quando aplicável.

### Canonical contract

- participante usa `participantId`;
- espécime/amostra usa `specimenId`;
- coleções e contratos devem seguir os nomes canônicos definidos no backend;
- aliases antigos não fazem parte do contrato runtime.

## Test Strategy

Os comandos prioritários deste branch são:

```bash
npm --prefix api/backend run lint
npm --prefix api/backend run typecheck
npm --prefix api/backend run test:architecture
npm --prefix api/backend run seed:validate:essential
npm --prefix api/backend run seed:essential:dry-run
npm --prefix api/backend run current-state:ci

npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Notas:

- `test:architecture` usa `node --test`.
- Vitest e Playwright legados permanecem fora do contrato atual.
- As suítes reconstruídas no futuro deverão partir do estado canônico atual.

## Bootstrap and Seeds

- O sistema deve iniciar sem dados operacionais reais pré-carregados.
- O bootstrap essencial é manual, idempotente e restrito a dados estruturais mínimos.
- Dados de domínio reais, consentimentos assinados e artefatos operacionais não devem surgir automaticamente no startup.

## Local Development

Pré-requisitos:

- Git;
- Docker Engine ou Docker Desktop;
- Docker Compose v2.

Não é necessário instalar Node.js, MongoDB, Neo4j, Redis ou InfluxDB diretamente no host para a execução via Compose.

```bash
git clone https://github.com/deniseribeiro-beep/BioAvanceD-v2.git
cd BioAvanceD-v2
cp .env.docker.example .env.docker
```

Depois:

```bash
npm run compose:config
npm run compose:up
```

Serviços padrão:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: localhost:27017
- Redis: localhost:6379
- Neo4j Browser: http://localhost:7474
- Neo4j Bolt: localhost:7687
- InfluxDB: http://localhost:8086

## Security and Auditability

O sistema inclui:

- RBAC;
- logs estruturados;
- hashes SHA-256;
- Merkle trees e provas de inclusão;
- cadeia append-only para movimentações de amostras;
- mecanismos de conformidade e evidência.

A documentação não deve afirmar imutabilidade absoluta enquanto as raízes de Merkle não estiverem assinadas e ancoradas em um domínio de confiança independente.

## Documentation and Scope

- `docs/` reúne documentação técnica de operação, importação, deploy e desenvolvimento.
- IA/XAI/Assistente Inteligente devem ser tratados como roadmap, não como funcionalidade já entregue.
- Compatibilidade com aliases legados e coleções antigas não deve ser reintroduzida.

## Cleanup and Exit

```bash
npm run compose:down
```

## License

Projeto desenvolvido para fins acadêmicos, científicos e de demonstração técnica.
