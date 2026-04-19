# Sistema de Gerenciamento de Amostras Biológicas – BioAvanceD

Sistema React desenvolvido com base no diagrama UML de classes para gerenciamento de pacientes, amostras biológicas, resultados de laboratório, equipamentos, monitoramento de temperatura, sensores, políticas e logs do sistema.

**Status**: ✅ **100% Validado e Funcional (31 de Março de 2026)**

---

## ✅ Relatório de QA Completo

### Validação de Testes (4 Fases)

| Fase | Categoria | Testes | Status |
|------|-----------|--------|--------|
| **1** | Backend Unit Tests | 18 | ✅ 18/18 PASSOU |
| **1** | Backend authConsent (Quarentena Lógica) | 6 | ✅ 6/6 PASSOU |
| **1** | Backend Factories | 3 | ✅ 3/3 PASSOU |
| **1** | Backend Compliance (FHIR R4, LGPD, ISO 20387, MQTT, DataMatrix) | 9 | ✅ 9/9 PASSOU |
| **1** | Backend Integration Tests | 5 | ✅ 5/5 PASSOU |
| **2** | Frontend Smoke Tests | 3 | ✅ 3/3 PASSOU |
| - | **TOTAL** | **44** | **✅ 100% SUCESSO** |

**Conformidade Validada**:
- ✅ **FHIR R4**: Patient/Specimen serialization
- ✅ **LGPD**: Criptografia AES-256-GCM de PII
- ✅ **ISO 20387**: Chain of Custody com auditoria imutável
- ✅ **MQTT**: Signature validation HMAC
- ✅ **DataMatrix/Code128**: Barcode industrial generation

**Inovações Técnicas Validadas**:
- ✅ **Motor Semântico (Neo4j)**: ORPHA → HPO → Biomarcadores com topological quarantine
- ✅ **Quarentena Lógica (e-Consent)**: authConsent middleware bloqueia amostra sem TCLE
- ✅ **Zod Validation**: Multi-step Intake Wizard com rejeição de texto livre
- ✅ **Smart Import**: BatchValidationEngine com validação estruturada

**Documentação**:
- 📄 [AUDIT_REPORT_FINAL.md](./AUDIT_REPORT_FINAL.md) - Relatório detalhado de auditoria
- 📄 [Arquitetura de Software v2.0](./Documents/# Arquitetura de Software.md) - Documentação técnica atualizada
- 📄 [Contexto SPREC/MIABIS](./docs/CONTEXTO_SPREC_MIABIS.md) - Base conceitual, algoritmo de pontuação e referências ISBER/MIABIS

---

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

## 🐳 Ambientes Docker

Este repositório usa três fluxos separados:

- desenvolvimento com hot-reload via `docker-compose.override.yml`
- testes via `docker-compose.test.yml`
- produção local via `docker-compose.yml`

### Desenvolvimento local com HMR

```powershell
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.override.yml up -d backend frontend
```

Frontend: <http://localhost:5173>

Para parar:

```powershell
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.override.yml down
```

### Testes em Docker

```powershell
npm run docker:test:backend
npm run docker:test:frontend
```

### Produção local

```powershell
npm run docker:local:up
npm run docker:local:ps
npm run docker:local:logs
npm run docker:local:down
```

### URLs locais após subir

- Frontend: <http://localhost:8080>
- Backend API: <http://localhost:3000>
- Nginx Proxy: <http://localhost:80>
- Neo4j Browser: <http://localhost:7474>
- InfluxDB UI: <http://localhost:8086>

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
