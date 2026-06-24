# BioAvanceD

BioAvanceD é um sistema médico-informacional para gestão digital de biobancos, com foco em governança de biospecímenes, consentimento, rastreabilidade, qualidade pré-analítica, cadeia fria e interoperabilidade semântica.

O projeto combina frontend React/Vite, backend Node.js/Express e persistência poliglota com MongoDB, Redis, Neo4j e InfluxDB.

## Visão geral

Principais módulos funcionais:

1. Pacientes/doadores.
2. Consentimento e TCLE.
3. Cadastro integrado de amostras.
4. Governança RCS-GOV/SPREC.
5. Armazenamento físico e etiquetas.
6. Equipamentos, freezers, sensores e políticas de temperatura.
7. Incidentes de cadeia fria e quarentena operacional.
8. Terminologias clínicas, ORPHA, OMIM, CID-10, HPO e ATC.
9. Auditoria, RBAC e rastreabilidade.

## Stack

- Frontend: React, TypeScript, Vite.
- Backend: Node.js, Express.
- Banco documental: MongoDB.
- Grafo de linhagem/consentimento: Neo4j.
- Telemetria: InfluxDB.
- Cache/eventos: Redis.
- Testes: Vitest, Supertest e scripts de auditoria.

## Princípio de bootstrap limpo

O sistema deve subir em banco limpo com apenas dados estruturais e dados de referência essenciais.

O bootstrap essencial não deve criar por padrão:

- pacientes;
- amostras;
- consentimentos assinados;
- resultados;
- biomarcadores reais;
- incidentes;
- sensores, freezers ou localizações preenchidas;
- usuários administrativos com credencial fixa;
- dumps ou dados demo.

Dados operacionais devem ser criados pelo fluxo da aplicação ou por seeds sintéticos explicitamente marcados como `demo`.

## Dados essenciais esperados

Após o seed essencial, o banco deve conter apenas:

- coleções canônicas e índices mínimos;
- roles e permissões;
- dados de referência RCS-GOV;
- SPREC mínimo;
- MIABIS mínimo;
- HPO mínimo necessário;
- regras de validação clínica essenciais;
- bootstrap ATC mínimo;
- log técnico de inicialização, quando aplicável.

## Instalação local

Instale as dependências principais:

```bash
npm install
npm --prefix api/backend install
npm --prefix frontend install
```

Configure variáveis de ambiente a partir dos exemplos disponíveis. Não versione arquivos `.env`, chaves, tokens ou certificados.

## Variáveis principais

Preencha no ambiente local ou no `.env.docker`:

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

Para auditoria local sem integrações externas, mantenha:

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

<<<<<<< HEAD
Ou usando os scripts da raiz:
=======
### Seeds e Índices RCS-GOV

Após os containers estarem saudáveis:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run migrate:rcs
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run seed
```

O seed do backend inclui o modelo `RCS-GOV-1.0`, catálogos SPREC, severidades, pesos, thresholds e regras de governança.

### Criar Primeiro Admin

O sistema não cria administrador por padrão, e o seed essencial não cria usuário.
O primeiro admin só pode ser criado quando a coleção `users` estiver vazia. A
senha temporária vem de variável de ambiente, não é impressa no console, e o
usuário é criado com `forceReset: true`. Após executar o bootstrap, remova as
variáveis do ambiente.

Windows PowerShell:

```powershell
$env:BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
$env:BOOTSTRAP_ADMIN_EMAIL="admin@example.org"
$env:BOOTSTRAP_ADMIN_USERNAME="admin"
$env:BOOTSTRAP_ADMIN_TEMP_PASSWORD="DefinaUmaSenhaTemporariaForte@123"
$env:BOOTSTRAP_ADMIN_FORCE_RESET="true"
npm.cmd --prefix api/backend run admin:create-first
Remove-Item Env:\BOOTSTRAP_ADMIN_NAME
Remove-Item Env:\BOOTSTRAP_ADMIN_EMAIL
Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME
Remove-Item Env:\BOOTSTRAP_ADMIN_TEMP_PASSWORD
Remove-Item Env:\BOOTSTRAP_ADMIN_FORCE_RESET
```

Linux/CENAPAD:

```bash
export BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
export BOOTSTRAP_ADMIN_EMAIL="admin@example.org"
export BOOTSTRAP_ADMIN_USERNAME="admin"
export BOOTSTRAP_ADMIN_TEMP_PASSWORD="DefinaUmaSenhaTemporariaForte@123"
export BOOTSTRAP_ADMIN_FORCE_RESET="true"
npm --prefix api/backend run admin:create-first
unset BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_TEMP_PASSWORD BOOTSTRAP_ADMIN_FORCE_RESET
```

Docker:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run admin:create-first
```

### Logs, Status e Parada

Logs de backend e frontend:
>>>>>>> 2a96483 (chore: sanitize bootstrap seeds and secure first admin flow)

```bash
npm run dev:up
npm run dev:logs
npm run dev:ps
npm run dev:down
```

Serviços esperados:

- Frontend: http://localhost:5173
- Backend: http://localhost:3000
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

Esse seed deve ser idempotente e não deve executar `deleteMany` em coleções operacionais. Ele também não deve criar pacientes, amostras, consentimentos, resultados, sensores, freezers, incidentes ou usuário administrativo.

## Criar primeiro administrador com bootstrap seguro

O sistema não cria administrador por padrão. O primeiro administrador deve ser criado explicitamente após o banco estar inicializado.

Regras do bootstrap seguro:

- só cria o primeiro administrador se a coleção `users` estiver vazia;
- se já existir qualquer usuário, o script encerra sem alteração;
- a credencial temporária deve vir de variável de ambiente;
- a credencial temporária não deve ser impressa no console;
- o usuário deve ser criado com `accessType: 4` e `roleName: "Administrador"`;
- o usuário deve ser criado com `forceReset: true` para troca obrigatória no primeiro acesso;
- as variáveis de ambiente devem ser removidas após a execução.

### Windows PowerShell

```powershell
$env:BOOTSTRAP_ADMIN_NAME="Nome do Administrador"
$env:BOOTSTRAP_ADMIN_EMAIL="email.institucional@exemplo.br"
$env:BOOTSTRAP_ADMIN_USERNAME="admin.inicial"
$env:BOOTSTRAP_ADMIN_TEMP_PASSWORD="defina-uma-credencial-temporaria-forte"
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
export BOOTSTRAP_ADMIN_EMAIL="email.institucional@exemplo.br"
export BOOTSTRAP_ADMIN_USERNAME="admin.inicial"
export BOOTSTRAP_ADMIN_TEMP_PASSWORD="defina-uma-credencial-temporaria-forte"
export BOOTSTRAP_ADMIN_FORCE_RESET="true"

npm --prefix api/backend run admin:create-first

unset BOOTSTRAP_ADMIN_NAME
unset BOOTSTRAP_ADMIN_EMAIL
unset BOOTSTRAP_ADMIN_USERNAME
unset BOOTSTRAP_ADMIN_TEMP_PASSWORD
unset BOOTSTRAP_ADMIN_FORCE_RESET
```

### Docker

Defina as variáveis no ambiente do container ou execute com variáveis exportadas no shell antes do comando:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run admin:create-first
```

Fluxos antigos de criação de administrador com credencial fixa não devem ser usados como procedimento recomendado.

## Ordem recomendada para ambiente limpo

```bash
npm --prefix api/backend run seed:essential
npm --prefix api/backend run admin:create-first
npm --prefix api/backend run test:ci
npm run audit:full
```

No CENAPAD, após subir MongoDB, Redis, InfluxDB, Neo4j, backend e frontend, use a mesma lógica:

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
- pacientes, amostras, consentimentos ou resultados reais.

Versionar:

- código-fonte;
- scripts auditáveis;
- configurações sem segredo;
- documentação;
- exemplos de ambiente;
- dados mínimos de referência, como `rcs-*.json` e seeds mínimos explicitamente sanitizados.

## Integrações externas

Por padrão, o ambiente de auditoria deve permanecer local e sem cloud externa.

Desabilitado por padrão:

- storage externo;
- sincronização externa de terminologias;
- lookup externo HPO;
- lookup externo de drogas;
- MQTT externo.

Integrações externas devem ser habilitadas apenas por flags explícitas e com variáveis de ambiente fora do repositório.

## Licença

Projeto desenvolvido para fins acadêmicos, científicos e de demonstração técnica.
