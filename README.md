# Sistema de Gerenciamento de Amostras Biológicas – BioAvanceD

Sistema React desenvolvido com base no diagrama UML de classes para gerenciamento de pacientes, amostras biológicas, resultados de laboratório, equipamentos, monitoramento de temperatura, sensores, políticas e logs do sistema.

## 🚀 Tecnologias

- **React 18** - Biblioteca JavaScript para construção de interfaces
- **TypeScript** - Superset JavaScript com tipagem estática
- **Vite** - Build tool moderna e rápida
- **React Router** - Roteamento para aplicações React

## 📋 Funcionalidades

### Módulos Principais

1. **Dashboard** - Visão geral do sistema com estatísticas
2. **Pacientes** - Gerenciamento completo de pacientes com informações clínicas
3. **Amostras** - Controle de amostras biológicas (tipo, origem, protocolo, localização)
4. **Resultados** - Gerenciamento de resultados de análises laboratoriais
5. **Equipamentos** - Cadastro e controle de equipamentos de armazenamento
6. **Temperatura** - Monitoramento em tempo real de temperatura
7. **Sensores** - Gerenciamento de sensores de temperatura
8. **Políticas** - Configuração de políticas e limites de temperatura
9. **Usuários** - Gerenciamento de usuários e permissões
10. **Logs** - Registro de atividades e eventos do sistema

## 🏗️ Estrutura do Projeto

```
BIO/
├── src/
│   ├── components/
│   │   ├── Layout/          # Componentes de layout (Sidebar, Header)
│   │   └── UI/              # Componentes reutilizáveis (Button, Card, Table, Modal, Input)
│   ├── pages/               # Páginas principais do sistema
│   ├── types/
│   │   └── models.ts        # Modelos TypeScript baseados no diagrama UML
│   ├── App.tsx              # Componente principal com rotas
│   ├── App.css              # Estilos globais
│   └── main.tsx             # Ponto de entrada da aplicação
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 📦 Instalação

1. Instale as dependências:
```bash
npm install
```

2. Inicie o servidor de desenvolvimento:
```bash
npm run start
```

3. Inicie o worker para gerenciamento de importação de arquivos
   ```bash
npm run worker
```

4. Inicie o Vite (Layout do Software)
   ```bash
npm run dev
```

5. Acesse a aplicação em `http://localhost:5173`

## 🏃 Scripts Disponíveis

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Cria a build de produção
- `npm run preview` - Visualiza a build de produção
- `npm run audit:full` - Executa auditoria completa do sistema (testes, build e análise estática)

### Testes QA

```bash
# Backend - Suite completa de testes (41 testes)
npm --prefix backend run test:ci

# Backend - Testes unitários apenas
npm --prefix backend run test:unit

# Backend - Testes de consentimento (authConsent)
npm --prefix backend run test:consent

# Frontend - Smoke tests & E2E (Playwright)
npm --prefix frontend run test:e2e

# Frontend - Type checking
npm --prefix frontend run typecheck
```

## 🛡️ Configuração recomendada de resiliência (backend)

Para activar o perfil de resiliência e validação dinâmica já implementado:

1. Copie o exemplo para o ambiente do backend:
```bash
Copy-Item backend/.env.resilience.example backend/.env
```

   Para baseline regulatório estrito (fail-closed):

```bash
Copy-Item backend/.env.resilience.strict.example backend/.env
```

2. Ajuste os segredos e endpoints reais (Mongo, Redis, Neo4j, Influx) no `backend/.env`.

3. Confirme os pontos críticos:
- `LINEAGE_MODE=fail-open` para permitir quarentena topológica quando Neo4j cair.
- `TELEMETRY_CRITICAL_TEMP=-80` e `TELEMETRY_CRITICAL_DURATION_HOURS=2` para gatilho IoT de invalidação em cascata.
- `NEO4J_RETRY_*` para controlar taxa/lote/tentativas do reprocessamento de quarentena.

Atalhos por ambiente (backend):

```bash
# DEV/HOMOLOG permissivo
Copy-Item backend/.env.resilience.example backend/.env

# HOMOLOG/PROD estrito (fail-closed)
Copy-Item backend/.env.resilience.strict.example backend/.env
```

## 🎨 Design

O sistema utiliza um design moderno e limpo com:
- Paleta de cores consistente
- Interface responsiva
- Componentes reutilizáveis
- Navegação intuitiva com sidebar
- Modais para formulários
- Tabelas interativas

## 📊 Modelos de Dados

O sistema implementa os seguintes modelos baseados no diagrama UML:

- **Patient** - Informações completas do paciente
- **Sample** - Dados das amostras biológicas
- **Result** - Resultados de análises
- **Equipment** - Equipamentos de armazenamento
- **Location** - Localização física das amostras
- **User** - Usuários do sistema
- **SpecificUser** - Usuários com MFA
- **Temperature** - Leituras de temperatura
- **Sensor** - Sensores de monitoramento
- **Policy** - Políticas de temperatura
- **Log** - Logs de auditoria

## 🔄 Próximos Passos

Para integrar com um backend:

1. Configure as URLs da API em um arquivo de configuração
2. Substitua os dados mockados por chamadas à API usando axios
3. Implemente tratamento de erros e loading states
4. Adicione autenticação e autorização
5. Implemente validações de formulário mais robustas

## ✅ Validação e Testes Completos

### Executar Suite de QA Completa

```bash
# Backend - Todos os testes (41 total)
npm --prefix backend run test:ci

# Frontend - Smoke tests e E2E
npm --prefix frontend run test:e2e

# Ambos (backend + frontend)
npm --prefix backend run test:ci && npm --prefix frontend run test:e2e
```

### Resultados Esperados

✅ **Backend (41 testes)**:
- 18 testes unitários (autenticação, validação, RBAC)
- 6 testes authConsent (bloqueio ético, consentimento)
- 3 testes de factories
- 9 testes compliance (FHIR R4, LGPD, ISO 20387, MQTT, DataMatrix)
- 5 testes de integração (Neo4j, Smart Blocking)

✅ **Frontend (3+ testes)**:
- Rotas principais carregam sem erro (6/6)
- Intake Wizard renderiza corretamente
- E-Consent page acessível

**Documentação Completa**: Ver [AUDIT_REPORT_FINAL.md](./AUDIT_REPORT_FINAL.md) para detalhes completos. 

## Docker Dev com Hot Reload

Esta seção descreve o modo mínimo recomendado para auditoria técnica do BioAvanceD-v2 em Docker. O fluxo sobe backend com `nodemon`, frontend com Vite HMR e bancos locais em containers. Não inclua segredos reais no repositório.

### Pré-Requisitos

- Docker Engine e Docker Compose v2.
- Node.js somente para usar os scripts `npm` da raiz; o runtime da aplicação roda nos containers.
- Portas livres no host: `3000`, `5173`, `27017`, `6379`, `7474`, `7687`, `8086` e `9229`.
- Em servidor Linux na nuvem, liberar no firewall apenas as portas necessárias para auditoria. Evite expor MongoDB, Redis, Neo4j, InfluxDB e inspector Node publicamente.

### Variáveis Obrigatórias

Crie o arquivo local a partir do exemplo:

```bash
cp .env.docker.example .env.docker
```

Preencha, no mínimo:

- `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `MONGO_URI`, `MONGO_DB`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `USER_ANON_SALT`
- `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_URI`
- `REDIS_URL`
- `INFLUXDB_INIT_USERNAME`, `INFLUXDB_INIT_PASSWORD`, `INFLUXDB_TOKEN`, `INFLUXDB_URL`
- `FRONTEND_URL`, `API_URL`, `ALLOWED_ORIGINS`
- `VITE_API_BASE_URL`, `VITE_HMR_HOST`, `VITE_HMR_PROTOCOL`, `VITE_HMR_CLIENT_PORT`
- `RESEND_API_KEY` e `EMAIL_FROM` somente se envio real de e-mail for auditado

Para auditoria local sem cloud externa, mantenha:

```env
ALLOW_CLOUD_INTEGRATIONS=false
ALLOW_EXTERNAL_TERMINOLOGY_SYNC=false
ALLOW_EXTERNAL_HPO_LOOKUP=false
ALLOW_EXTERNAL_DRUG_LOOKUP=false
MQTT_ENABLED=false
```

### Serviços Docker

- `mongodb`: banco principal local/container.
- `backend`: API Node/Express em `http://localhost:3000`, com `nodemon` e inspector em `9229`.
- `frontend`: Vite em `http://localhost:5173`, com hot reload.
- `redis`: fila/cache local quando usado pelo backend.
- `neo4j`: linhagem/grafo local quando usado pelo backend.
- `influxdb`: telemetria local quando usada pelo backend.

### Subir Ambiente

Com script da raiz:

```bash
npm run dev:up
```

Com Docker Compose direto:

```bash
docker compose --env-file .env.docker -f docker-compose.yml up --build backend frontend
```

### Seeds e Índices RCS-GOV

Após os containers estarem saudáveis:

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run migrate:rcs
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run seed
```

O seed do backend inclui o modelo `RCS-GOV-1.0`, catálogos SPREC, severidades, pesos, thresholds e regras de governança.

### Criar Usuário Admin

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend npm run user:create-admin
```

Depois de criar o usuário, altere a senha inicial pelo fluxo da aplicação ou por procedimento administrativo seguro. Não versionar credenciais.

### Logs, Status e Parada

Logs de backend e frontend:

```bash
npm run dev:logs
```

Todos os serviços:

```bash
docker compose --env-file .env.docker -f docker-compose.yml logs -f
```

Status:

```bash
npm run dev:ps
```

Parar:

```bash
npm run dev:down
```

Ou direto:

```bash
docker compose --env-file .env.docker -f docker-compose.yml down
```

### Confirmar Online

Frontend:

```bash
curl -I http://localhost:5173
```

Backend:

```bash
curl -I http://localhost:3000
```

Se o backend não tiver rota raiz em alguma versão, confirme pelos logs:

```bash
docker compose --env-file .env.docker -f docker-compose.yml logs backend
```

Também é possível validar pelo navegador:

- Frontend: <http://localhost:5173>
- Backend API: <http://localhost:3000>
- Neo4j Browser local: <http://localhost:7474>
- InfluxDB local: <http://localhost:8086>

### Integrações Cloud

Para o ambiente Docker de auditoria, integrações cloud externas foram removidas, desabilitadas ou colocadas atrás de flags locais. O MongoDB deve usar container/local; URIs `mongodb+srv://` ficam bloqueadas quando `ALLOW_CLOUD_INTEGRATIONS=false`.

Desabilitado por padrão:

- Supabase, Firebase, AWS/S3, Cloudinary, Google Cloud, Azure, Vercel, Render, Railway e storage externo.
- Sincronização externa de terminologias.
- Lookup externo HPO.
- Lookup externo de drogas.
- MQTT externo.

Permitido:

- Resend é a única integração externa permitida. Sem `RESEND_API_KEY`, fluxos de desenvolvimento usam comportamento local/mockado quando suportado.

### Servidor Linux na Nuvem

- Use `.env.docker` criado a partir de `.env.docker.example`, nunca comitado.
- Ajuste `FRONTEND_URL`, `API_URL`, `ALLOWED_ORIGINS` e `VITE_HMR_HOST` para o domínio ou IP público usado na auditoria.
- Se houver proxy reverso/HTTPS, configure `VITE_HMR_PROTOCOL=wss` e `VITE_HMR_CLIENT_PORT=443` conforme o proxy.
- Mantenha `TRUST_PROXY=1` quando o backend estiver atrás de proxy.
- Proteja as portas internas dos bancos com firewall/security group; para auditoria pública, exponha preferencialmente apenas `5173` e/ou a porta do proxy.

## 📁 Política de versionamento para GitHub

Os arquivos `.gitignore` da raiz, backend e frontend foram ajustados para manter no repositório apenas o necessário para desenvolvimento colaborativo e CI/CD.

### O que não deve subir para o GitHub

- dependências locais (`node_modules`)
- variáveis de ambiente e segredos (`.env*`, chaves e certificados)
- artefatos de build e cache (`dist`, `build`, `coverage`, `.vite`, `.cache`)
- logs e saídas temporárias de testes
- dados locais de execução/volumes Docker (`data/mongodb`, `data/neo4j`, `data/redis`, `data/influxdb`)
- backups e temporários gerados durante operação

### O que deve subir para o GitHub

- código-fonte (`backend/src`, `frontend/src`, scripts)
- configurações versionáveis (`package.json`, `docker-compose.yml`, configs)
- documentação (`README.md`, `docs`)
- exemplos de ambiente (`.env.example`, quando existir)

### Se arquivos já estavam versionados antes

Após atualizar `.gitignore`, remova do índice do Git os artefatos já rastreados:

```bash
git rm -r --cached node_modules backend/node_modules frontend/node_modules
git rm -r --cached data/mongodb data/neo4j data/redis data/influxdb data/_sprec_tmp
git rm -r --cached frontend/playwright-report frontend/test-results test-results
git rm -r --cached backend/backups backend/test-output.txt
git add .
git commit -m "chore: ajusta gitignore e limpeza de artefatos locais"
```

## 📝 Licença

Este projeto foi desenvolvido para fins educacionais e de demonstração.
