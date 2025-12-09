# BioAvanceD - Backend API

Sistema de gerenciamento de amostras biológicas e pacientes.

## 🚀 Início Rápido

### Instalação

```bash
npm install
```

### Configuração

1. Copie o arquivo `.env.example` para `.env` (ou use `npm run setup`)
2. Configure as variáveis de ambiente:
   - `MONGO_URI` - URI de conexão MongoDB (sem nome do banco)
   - `MONGO_DB` - Nome do banco principal
   - `MONGO_DB_NOVO` - Nome do banco novo
   - `JWT_SECRET` - Chave secreta para JWT
   - `PORT` - Porta do servidor (padrão: 3000)

### Criar Banco de Dados

```bash
npm run create-db
```

### Criar Usuário Administrador

```bash
npm run create-admin
```

**Credenciais padrão:**
- Email/Username: `admin@bioavanced.com` ou `admin` (variável mantida em minúsculo)
- Senha: `1234@5678`

⚠️ **IMPORTANTE:** Altere a senha no primeiro login!

### Executar

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## 📚 Documentação

- [Estrutura do Projeto](./ESTRUTURA_PROJETO.md)
- [Rotas da API](./ROTAS_API.md)
- [Resumo de Implementação](./RENOMEACAO_E_IMPLEMENTACAO_COMPLETA.md)

## 🛠️ Scripts Disponíveis

- `npm run dev` - Inicia servidor em modo desenvolvimento
- `npm start` - Inicia servidor em modo produção
- `npm run create-db` - Cria banco de dados e coleções
- `npm run create-admin` - Cria usuário administrador
- `npm run audit` - Executa auditoria do banco de dados
- `npm run test:mongo` - Testa conexão MongoDB

## 📦 Estrutura

```
backend/
├── src/
│   ├── config/        # Configurações
│   ├── database/      # Conexão MongoDB
│   ├── models/        # Modelos de dados
│   ├── controllers/   # Controllers
│   ├── services/      # Lógica de negócio
│   ├── routes/        # Rotas da API
│   ├── middleware/    # Middlewares
│   └── utils/         # Utilitários
├── scripts/           # Scripts auxiliares
└── uploads/           # Uploads temporários
```

## 🔐 Autenticação

O sistema usa JWT para autenticação. Todas as rotas (exceto `/api/auth/login` e `/api/auth/register`) requerem token no header:

```
Authorization: Bearer <token>
```

## 📝 Requisitos Funcionais Implementados

- ✅ RF001 - Sistema de Autenticação com MFA
- ✅ RF003 - Cadastro de Usuário
- ✅ RF004 - Cadastro de Amostra
- ✅ RF005 - Cadastro de Paciente
- ✅ RF006 - Retirada de Amostra
- ✅ RF007 - Upload e Importação de Dados
- ✅ RF009 - Registro de Temperatura e Sensores
- ✅ RF011 - Assistente Inteligente

## 🌐 API Base URL

- Desenvolvimento: `http://localhost:3000/api`
- Health Check: `http://localhost:3000/api/health`

## 📄 Licença

Este projeto é privado e confidencial.
