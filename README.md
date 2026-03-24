# Sistema de Gerenciamento de Amostras Biológicas

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
- `npm run audit:full` - Executa auditoria completa do sistema (testes, build e análise estática de cobertura de funções) e gera relatório em `reports/system-audit/`

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

## 📝 Licença

Este projeto foi desenvolvido para fins educacionais e de demonstração.
