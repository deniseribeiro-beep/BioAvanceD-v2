# BioAvanceD

BioAvanceD é um protótipo de sistema médico-informacional para gestão digital de biobancos, desenvolvido para validar uma arquitetura poliglota, orientada a eventos e governada em tempo de execução para biospecímenes, consentimento, rastreabilidade, qualidade pré-analítica, cadeia fria e interoperabilidade semântica.

O projeto combina frontend React/Vite, backend Node.js/Express e persistência com MongoDB, Neo4j, InfluxDB e Redis.

## Escopo atual do protótipo

O protótipo atual tem foco em validação técnica e sistêmica com dados fictícios ou sintéticos. Ele não deve iniciar com dados reais nem com dados operacionais pré-carregados.

Módulos centrais:

1. Cadastro e governança de pacientes/doadores.
2. Consentimento dinâmico e TCLE.
3. Intake clínico e cadastro integrado de amostras.
4. Governança pré-analítica RCS-GOV, SPREC e MIABIS.
5. Rastreabilidade e cadeia de custódia append-only.
6. Armazenamento físico, etiquetas e localização.
7. Equipamentos, sensores, políticas de temperatura e cadeia fria.
8. Quarentena lógica por consentimento, qualidade e incidente de cadeia fria.
9. Terminologias clínicas e semânticas: ORPHA, OMIM, CID, HPO, ATC e FHIR.
10. RBAC, auditoria, segurança e bootstrap controlado.

Módulos de inteligência artificial assistiva ou preditiva devem ser tratados como escopo futuro, exceto quando houver implementação e validação específicas.

## Stack

- Frontend: React, TypeScript e Vite.
- Backend: Node.js 22 e Express.
- Banco documental: MongoDB.
- Grafo de linhagem e consentimento: Neo4j.
- Telemetria e séries temporais: InfluxDB.
- Cache, filas e eventos: Redis.
- Orquestração: Docker Compose.
- Testes: Vitest, Supertest, Playwright e scripts de auditoria.

## Documentos acadêmicos e científicos

Documentos científicos, submissões, materiais de pesquisa, CEP, figuras e pacotes de registro INPI ficam em `academico/`.

O diretório `docs/` é reservado para documentação técnica de operação, importação, deploy e desenvolvimento.

## Princípio de bootstrap limpo

O sistema deve iniciar em banco limpo com apenas dados estruturais e dados de referência essenciais.

O bootstrap essencial não deve criar por padrão:

- pacientes;
- amostras;
- consentimentos assinados;
- resultados;
- observações clínicas reais;
- biomarcadores reais;
- incidentes;
- sensores, freezers ou localizações preenchidas;
- usuário administrador com credencial fixa;
- dumps ou dados de demonstração.

Dados operacionais devem ser criados pelo fluxo da aplicação ou por fixtures de teste e migrations explícitas, nunca por seed automático.

## Execução reproduzível com Docker Compose

Pré-requisitos:

- Git;
- Docker Engine ou Docker Desktop;
- Docker Compose v2.

Não é necessário instalar Node.js, MongoDB, Neo4j, Redis ou InfluxDB diretamente no host.

```bash
git clone https://github.com/deniseribeiro-beep/BioAvanceD-v2.git
cd BioAvanceD-v2
cp .env.docker.example .env.docker
```

Preencha `.env.docker` com valores próprios do ambiente. Não versione arquivos de ambiente reais, chaves, tokens, certificados ou dumps.

Integrações externas devem permanecer desabilitadas durante a validação local, salvo quando um cenário exigir ativação explícita.

Valide e inicie a pilha:

```bash
npm run compose:config
npm run compose:up
```

O Compose utiliza volumes nomeados e não depende de caminhos absolutos, usuário do host ou infraestrutura institucional específica.

Serviços padrão:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: localhost:27017
- Redis: localhost:6379
- Neo4j Browser: http://localhost:7474
- Neo4j Bolt: localhost:7687
- InfluxDB: http://localhost:8086

As portas podem ser substituídas por variáveis no arquivo de ambiente.

Estado, logs e smoke test:

```bash
npm run compose:ps
npm run compose:logs
```

## Inicialização limpa do banco

Após os serviços estarem saudáveis, a base deve ser inicializada apenas por migrations e bootstrap estrutural explícito, sem população automática de entidades de domínio.

## Histórico do pipeline Orphanet

O pipeline anterior foi descontinuado e não integra o runtime ou os procedimentos atuais. A documentação histórica está disponível em `docs/orphanet-artifact-pipeline.md`.

## Criar o primeiro administrador

O sistema não cria administrador por padrão. A criação do primeiro administrador deve ser uma ação explícita, com dados temporários fornecidos por variáveis seguras do ambiente.

```bash
docker compose --env-file .env.docker.example -f compose.yml -f compose.dev.yml exec backend npm run admin:create-first
```

O script só deve criar o primeiro administrador quando a coleção de usuários estiver vazia e deve exigir troca da credencial temporária no primeiro acesso.

## Testes

Backend:

```bash
docker compose --env-file .env.docker.example -f compose.yml -f compose.dev.yml exec backend npm run test:ci
```

Frontend:

```bash
docker compose --env-file .env.docker.example -f compose.yml -f compose.dev.yml exec frontend npm run typecheck
docker compose --env-file .env.docker.example -f compose.yml -f compose.dev.yml exec frontend npm run build
```

Testes da pilha:

```bash
npm run test:integration
npm run test:e2e
```

Auditoria completa:

```bash
npm run audit:full
```

## Incidentes de cadeia fria

Fluxo esperado:

```text
telemetria fora da política
→ incidente COLD_CHAIN aberto ou atualizado
→ resolução do sensor, equipamento ou localização afetada
→ amostras vinculadas entram em QUARANTINE/BLOCKED
→ resolução do incidente não libera automaticamente as amostras
→ amostras permanecem como PENDING_REVIEW até avaliação pós-incidente
```

## Segurança e auditabilidade

O protótipo inclui:

- RBAC;
- criptografia AES-256-GCM para campos sensíveis;
- pseudonimização e referências indiretas;
- logs estruturados;
- hashes SHA-256;
- Merkle trees e provas de inclusão;
- cadeia append-only para movimentações de amostras.

A documentação não deve afirmar imutabilidade absoluta enquanto as raízes de Merkle não estiverem assinadas e ancoradas em um domínio de confiança independente.

## Política de versionamento

Versionar:

- código-fonte;
- testes automatizados;
- Dockerfiles e Compose;
- scripts portáveis;
- configurações sem segredo;
- documentação técnica essencial;
- fontes oficiais necessárias à reprodução dos seeds, quando permitido;
- dados mínimos explicitamente sanitizados.

Manter fora do repositório:

- arquivos de ambiente reais;
- chaves, certificados e tokens;
- dados operacionais reais;
- dependências instaladas;
- logs e relatórios temporários;
- conteúdo persistente dos bancos.

## Integrações externas

Integrações externas devem ser habilitadas apenas por flags explícitas e variáveis fornecidas fora do repositório.

## Alinhamento científico

O protótipo está alinhado à validação técnica de uma arquitetura para biobancos digitais, com ênfase em persistência poliglota, interoperabilidade FHIR/MIABIS/SPREC, consentimento dinâmico, RCS-GOV, rastreabilidade, cadeia fria, quarentena e pipelines semânticos versionados.

## Encerramento

```bash
npm run compose:down
```

## Licença

Projeto desenvolvido para fins acadêmicos, científicos e de demonstração técnica.
