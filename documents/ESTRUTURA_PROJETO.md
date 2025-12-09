# Estrutura do Projeto BioAvanceD - Backend

## 📁 Estrutura de Pastas

```
backend/
├── src/
│   ├── config/
│   │   └── env.js                    # Configuração de variáveis de ambiente
│   ├── database/
│   │   └── mongo.js                  # Conexão MongoDB (MongoClient)
│   ├── models/                        # Modelos de validação e estrutura
│   │   ├── Patient.js
│   │   ├── Sample.js
│   │   ├── User.js
│   │   ├── Log.js
│   │   ├── Temperature.js
│   │   ├── Sensor.js
│   │   ├── Policy.js
│   │   ├── Location.js
│   │   ├── Result.js
│   │   └── Equipment.js
│   ├── middleware/
│   │   ├── auth.js                   # Autenticação JWT
│   │   └── rbac.js                    # Controle de acesso (RBAC)
│   ├── services/                      # Lógica de negócio
│   │   ├── auth.service.js           # RF001 - Login com MFA
│   │   ├── patient.service.js        # RF005 - Cadastro de paciente
│   │   ├── sample.service.js         # RF004, RF006 - Amostras
│   │   ├── temperature.service.js    # RF009 - Temperatura
│   │   ├── log.service.js             # RNF009 - Auditoria
│   │   └── paciente.service.js       # (legado)
│   ├── controllers/                   # Handlers HTTP
│   │   ├── auth.controller.js
│   │   └── paciente.controller.js
│   ├── routes/                        # Definição de rotas
│   │   ├── auth.routes.js
│   │   ├── patient.routes.js
│   │   └── paciente.routes.js        # (legado)
│   └── utils/
│       └── logger.js                  # Utilitário de logging
├── scripts/
│   ├── create-db.js                   # Cria banco de dados novo
│   ├── test-connection-mongo.js      # Testa conexão MongoDB
│   └── audit-database.js             # Auditoria completa do banco
├── server.js                          # Servidor Express principal
├── package.json
└── .env
```

## 🔐 Autenticação e Autorização

### RF001 - Login com MFA
- **Endpoint**: `POST /api/auth/login`
- **MFA**: Suporta autenticação de dois fatores usando TOTP (speakeasy)
- **JWT**: Tokens com expiração de 24h

### RNF008 - RBAC (Role-Based Access Control)
- **Roles**:
  - `1` = UsuarioExterno
  - `2` = Tecnico
  - `3` = Coordenador
  - `4` = Administrador

## 📊 Collections MongoDB

### Banco Principal (`bioavanced` - variável em minúsculo)
- `pacientes` - Dados dos pacientes
- `amostras` - Amostras biológicas
- `users` - Usuários do sistema
- `logs` - Logs de auditoria
- `temperatures` - Leituras de temperatura
- `sensors` - Sensores
- `policies` - Políticas de temperatura
- `locations` - Localizações/Freezers
- `results` - Resultados de análise
- `equipment` - Equipamentos
- `alerts` - Alertas de temperatura

### Banco Novo (`bioavanced_novo` - variável em minúsculo)
- Criado via `npm run create-db`
- Coleções: `pacientes`, `amostras`, `logs`

## 🛣️ Rotas da API

### Autenticação (`/api/auth`)
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Registro de usuário
- `POST /api/auth/mfa/setup` - Configurar MFA
- `POST /api/auth/mfa/enable` - Ativar MFA

### Pacientes (`/api/patients`)
- `POST /api/patients` - Criar paciente (RF005)
- `GET /api/patients` - Listar pacientes
- `GET /api/patients/:id` - Buscar paciente
- `PUT /api/patients/:id` - Atualizar paciente

## 📝 Requisitos Implementados

### Requisitos Funcionais
- ✅ **RF001**: Login com MFA
- ✅ **RF003**: Cadastro de usuário
- ✅ **RF004**: Cadastro de amostra (service criado)
- ✅ **RF005**: Cadastro de paciente
- ✅ **RF006**: Retirada de amostra (service criado)
- ✅ **RF007**: Upload de arquivos (pendente - estrutura criada)
- ✅ **RF008**: Relatórios (pendente - estrutura criada)
- ✅ **RF009**: Registro de temperatura (service criado)
- ✅ **RF010**: Backup (pendente)
- ✅ **RF011**: Assistente Inteligente (pendente)

### Requisitos Não Funcionais
- ✅ **RNF007**: Criptografia (TLS via MongoDB)
- ✅ **RNF008**: RBAC implementado
- ✅ **RNF009**: Auditoria e rastreabilidade (LogService)

## 🔧 Scripts Disponíveis

```bash
npm run dev              # Inicia servidor em modo desenvolvimento
npm run start            # Inicia servidor em produção
npm run create-db        # Cria banco de dados novo
npm run audit            # Executa auditoria completa do banco
npm run test:mongo       # Testa conexão MongoDB
```

## 📦 Dependências Principais

- `express` - Framework web
- `mongodb` - Driver MongoDB (sem Mongoose)
- `jsonwebtoken` - Autenticação JWT
- `bcryptjs` - Hash de senhas
- `speakeasy` - MFA/TOTP
- `qrcode` - Geração de QR codes para MFA
- `cors` - CORS
- `dotenv` - Variáveis de ambiente

## 🚀 Próximos Passos

1. **Completar Services**:
   - Sample Service (parcial)
   - Temperature Service (parcial)
   - Import Service (RF007)
   - Report Service (RF008)
   - Backup Service (RF010)
   - Assistant Service (RF011)

2. **Criar Controllers**:
   - Sample Controller
   - Temperature Controller
   - Sensor Controller
   - Location Controller
   - Result Controller
   - Log Controller
   - Dashboard Controller

3. **Criar Rotas**:
   - `/api/samples`
   - `/api/temperature`
   - `/api/sensors`
   - `/api/locations`
   - `/api/results`
   - `/api/logs`
   - `/api/dashboard`
   - `/api/import`
   - `/api/reports`
   - `/api/backup`
   - `/api/assistant`

4. **Implementar Funcionalidades**:
   - Sistema de importação (RF007)
   - Sistema de relatórios (RF008)
   - Sistema de backup (RF010)
   - Assistente Inteligente (RF011)

## 📚 Documentação Adicional

- Ver `backend/scripts/audit-database.js` para auditoria completa
- Ver models para estrutura de dados
- Ver services para lógica de negócio
- Ver controllers para handlers HTTP

