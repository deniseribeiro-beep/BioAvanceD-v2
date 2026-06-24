# BioAvanceD

BioAvanceD é um protótipo de sistema médico-informacional para gestão digital de biobancos, desenvolvido para validar uma arquitetura poliglota, orientada a eventos e governada em tempo de execução para biospecímenes, consentimento, rastreabilidade, qualidade pré-analítica, cadeia fria e interoperabilidade semântica.

O projeto combina frontend React/Vite, backend Node.js/Express e persistência com MongoDB, Neo4j, InfluxDB e Redis.

## Escopo atual do protótipo

O protótipo atual tem foco em validação técnica e sistêmica com dados fictícios/sintéticos. Ele não deve subir com dados reais nem com dados operacionais pré-carregados.

Módulos centrais:

1. Cadastro e governança de pacientes/doadores.
2. Consentimento dinâmico e TCLE.
3. Intake clínico e cadastro integrado de amostras.
4. Governança pré-analítica RCS-GOV/SPREC/MIABIS.
5. Rastreabilidade e cadeia de custódia append-only.
6. Armazenamento físico, etiquetas e localização.
7. Equipamentos, sensores, políticas de temperatura e cadeia fria.
8. Quarentena lógica por consentimento, qualidade e incidente de cadeia fria.
9. Terminologias clínicas e semânticas: ORPHA, OMIM, CID, HPO, ATC e FHIR.
10. RBAC, auditoria, segurança e bootstrap controlado.

Módulos de inteligência artificial assistiva ou preditiva devem ser tratados como escopo futuro, exceto quando houver implementação e validação específicas.

## Stack

- Frontend: React, TypeScript, Vite.
- Backend: Node.js, Express.
- Banco documental: MongoDB.
- Grafo de linhagem e consentimento: Neo4j.
- Telemetria e séries temporais: InfluxDB.
- Cache, filas e eventos: Redis.
- Testes: Vitest, Supertest, Playwright e scripts de auditoria.

## Documentos acadêmicos e científicos

Documentos científicos, submissões, materiais de pesquisa, CEP, figuras e pacotes de registro INPI ficam em `academico/`.

Estrutura:

- `academico/artigo-joms/`: manuscrito e arquivos suplementares do artigo.
- `academico/rcs-submetido/`: materiais de submissão relacionados ao RCS.
- `academico/inpi/`: pacote, hash e documentação de registro INPI.
- `academico/projeto-pesquisa/`: documentos de projeto de pesquisa.
- `academico/cep/`: documentos relacionados ao CEP.
- `academico/figuras/`: figuras e materiais visuais acadêmicos.

O diretório `docs/` deve permanecer reservado para documentação técnica de operação, importação, deploy e desenvolvimento.

## Princípio de bootstrap limpo

O sistema deve subir em banco limpo com apenas dados estruturais e dados de referência essenciais.

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
- dumps ou dados demo.

Dados operacionais devem ser criados pelo fluxo da aplicação ou por seeds sintéticos explicitamente marcados como `demo`.

## Dados essenciais esperados

Após o seed essencial, o banco deve conter apenas:

- coleções canônicas e índices mínimos;
- roles e permissões mínimas;
- dados de referência RCS-GOV;
- SPREC mínimo;
- MIABIS mínimo;
- HPO mínimo necessário;
- regras de validação clínica essenciais;
- bootstrap ATC mínimo;
- log técnico de inicialização, quando aplicável.

## Instalação local limpa

Para ter uma cópia igual à versão usada no ambiente CENAPAD, prefira clonar em uma pasta nova:

```bash
git clone https://github.com/deniseribeiro-beep/BioAvanceD-v2.git
cd BioAvanceD-v2
git checkout audit/intake-governance-i18n-orpha
```

Instale dependências:

```bash
npm install
npm --prefix api/backend install
npm --prefix frontend install
```

Configure variáveis de ambiente a partir dos exemplos disponíveis. Não versionar `.env`, chaves, tokens, certificados ou dumps.

## Variáveis principais

Preencha no ambiente local, `.env` ou `.env.docker`, conforme o modo de execução:

```env
MONGO_URI=
MONGO_DB=
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=
USER_ANON_SALT=
NEO4J_URI=
NEO4J_USERNAME=
NEO4J_PASSWORD=
REDIS_URL=
INFLUXDB_URL=
INFLUXDB_TOKEN=
INFLUXDB_ORG=
INFLUXDB_BUCKET=
FRONTEND_URL=
API_URL=
ALLOWED_ORIGINS=
```

Para auditoria local sem integrações externas:

```env
ALLOW_CLOUD_INTEGRATIONS=false
ALLOW_EXTERNAL_TERMINOLOGY_SYNC=false
ALLOW_EXTERNAL_HPO_LOOKUP=false
ALLOW_EXTERNAL_DRUG_LOOKUP=false
MQTT_ENABLED=false
```

## Subir ambiente Docker local

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker -f docker-compose.yml up --build backend frontend
```

Ou usando scripts da raiz:

```bash
npm run dev:up
npm run dev:logs
npm run dev:ps
npm run dev:down
```

Serviços esperados:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- MongoDB: localhost:27017
- Redis: localhost:6379
- Neo4j Browser: http://localhost:7474
- InfluxDB: http://localhost:8086

## Inicialização limpa do banco

Após os serviços estarem saudáveis, execute o seed essencial seguro:

```bash
npm --prefix api/backend run seed:essential
```

Em Docker:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run seed:essential
```

Esse seed deve ser idempotente e não deve executar `deleteMany` em coleções operacionais. Ele também não deve criar pacientes, amostras, consentimentos, resultados, sensores, freezers, incidentes ou usuário administrador.

## Criar primeiro administrador com bootstrap seguro

O sistema não cria administrador por padrão. O primeiro administrador deve ser criado explicitamente após o banco estar inicializado.

Regras:

- só cria o primeiro administrador se a coleção `users` estiver vazia;
- se já existir qualquer usuário, o script encerra sem alteração;
- a credencial temporária vem de variável de ambiente;
- a credencial temporária não é impressa no console;
- o usuário é criado com `accessType: 4` e `roleName: "Administrador"`;
- o usuário é criado com `forceReset: true` para troca obrigatória no primeiro acesso;
- as variáveis de ambiente devem ser removidas após a execução.

### Windows PowerShell

```powershell
$env:BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
$env:BOOTSTRAP_ADMIN_EMAIL="<email-institucional>"
$env:BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>"
$env:BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>"
$env:BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm.cmd --prefix api/backend run admin:create-first

Remove-Item Env:\BOOTSTRAP_ADMIN_NAME
Remove-Item Env:\BOOTSTRAP_ADMIN_EMAIL
Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME
Remove-Item Env:\BOOTSTRAP_ADMIN_TEMP_PASSWORD
Remove-Item Env:\BOOTSTRAP_ADMIN_FORCE_RESET
```

### Linux ou CENAPAD

```bash
export BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
export BOOTSTRAP_ADMIN_EMAIL="<email-institucional>"
export BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>"
export BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>"
export BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm --prefix api/backend run admin:create-first

unset BOOTSTRAP_ADMIN_NAME
unset BOOTSTRAP_ADMIN_EMAIL
unset BOOTSTRAP_ADMIN_USERNAME
unset BOOTSTRAP_ADMIN_TEMP_PASSWORD
unset BOOTSTRAP_ADMIN_FORCE_RESET
```

### Docker

Passe as variáveis para o container no momento da execução:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec \
  -e BOOTSTRAP_ADMIN_NAME="Nome do Administrador" \
  -e BOOTSTRAP_ADMIN_EMAIL="<email-institucional>" \
  -e BOOTSTRAP_ADMIN_USERNAME="<usuario-admin-inicial>" \
  -e BOOTSTRAP_ADMIN_TEMP_PASSWORD="<credencial-temporaria-forte-unica>" \
  -e BOOTSTRAP_ADMIN_FORCE_RESET="true" \
  backend npm run admin:create-first
```

Fluxos antigos de criação de administrador com credencial fixa não devem ser usados.

## Ordem recomendada para ambiente limpo

```bash
npm --prefix api/backend run seed:essential
npm --prefix api/backend run admin:create-first
npm --prefix api/backend run test:ci
npm run audit:full
```

No CENAPAD, após subir MongoDB, Redis, InfluxDB, Neo4j, backend e frontend, use a mesma sequência:

```bash
npm --prefix api/backend run seed:essential
npm --prefix api/backend run admin:create-first
npm --prefix api/backend run test:ci
```

## Testes

Backend:

```bash
npm --prefix api/backend run test:unit
npm --prefix api/backend run test:consent
npm --prefix api/backend run test:ci
```

Frontend:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Auditoria completa:

```bash
npm run audit:full
```

## Incidentes de cadeia fria

Incidentes ativos de cadeia fria devem bloquear operacionalmente as amostras afetadas.

Fluxo esperado:

```text
telemetria fora da política
→ incidente COLD_CHAIN aberto ou atualizado
→ resolução do sensor/freezer/localização afetada
→ amostras vinculadas entram em QUARANTINE/BLOCKED
→ resolução do incidente não libera automaticamente as amostras
→ amostras permanecem como PENDING_REVIEW até avaliação pós-incidente
```

## Política de versionamento

Não versionar:

- `.env`, `.env.local`, `.env.docker` com segredos reais;
- chaves, certificados, tokens e dumps;
- `node_modules`;
- artefatos de build/cache;
- logs e relatórios temporários;
- volumes locais de bancos (`data/mongodb`, `data/neo4j`, `data/redis`, `data/influxdb`);
- CSV/XML grandes de terminologias externas;
- pacientes, amostras, consentimentos ou resultados reais;
- evidências locais de execução geradas fora do fluxo de documentação aprovado.

Versionar:

- código-fonte;
- testes automatizados;
- scripts auditáveis;
- configurações sem segredo;
- documentação técnica essencial;
- exemplos de ambiente;
- dados mínimos de referência explicitamente sanitizados, como `rcs-*.json` e seeds `.min.json`.

## Limpeza local para clone limpo

Para ter no computador uma cópia igual ao repositório remoto limpo, prefira clonar em uma nova pasta.

Se precisar limpar uma cópia existente, confira antes o que será removido:

```bash
git clean -fdxn
```

Depois de revisar a lista, remova arquivos não rastreados:

```bash
git clean -fdx
```

Para descartar alterações locais e voltar exatamente ao estado remoto da branch:

```bash
git fetch origin
git reset --hard origin/audit/intake-governance-i18n-orpha
git clean -fdx
```

Use esses comandos somente depois de salvar qualquer arquivo local que ainda precise manter.

## Integrações externas

Por padrão, o ambiente de auditoria deve permanecer local e sem cloud externa.

Desabilitado por padrão:

- storage externo;
- sincronização externa de terminologias;
- lookup externo HPO;
- lookup externo de drogas;
- MQTT externo.

Integrações externas devem ser habilitadas apenas por flags explícitas e com variáveis de ambiente fora do repositório.

## Alinhamento científico

O protótipo atual está alinhado ao escopo de validação técnica de arquitetura para biobancos digitais, com ênfase em:

- persistência poliglota;
- interoperabilidade FHIR/MIABIS/SPREC;
- governança de consentimento em tempo de execução;
- RCS-GOV para qualificação pré-analítica;
- cadeia de custódia verificável;
- monitoramento de cadeia fria e quarentena pós-incidente;
- uso exclusivo de dados fictícios/sintéticos nas fases de desenvolvimento e validação técnica.

Esse escopo é compatível com validação de protótipo e com o parecer ético quando restrito a dados sintéticos/fictícios. Qualquer uso futuro de dados reais deve seguir nova apreciação ética quando exigido pelo CEP.

## Licença

Projeto desenvolvido para fins acadêmicos, científicos e de demonstração técnica.
