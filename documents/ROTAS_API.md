# Rotas da API BioAvanceD

## 🔐 Autenticação (`/api/auth`)

### RF001 - Login e MFA
- `POST /api/auth/login` - Login do usuário
  - Body: `{ email, password, mfaCode? }`
  - Retorna: `{ token, user }` ou `{ requiresMFA: true }`

- `POST /api/auth/register` - Registro de novo usuário
  - Body: `{ name, email, username, password, accessType, ... }`
  - Requer: Autenticação (dependendo da política)

- `POST /api/auth/mfa/setup` - Configurar MFA
  - Requer: Autenticação
  - Retorna: `{ secret, qrCode, manualEntryKey }`

- `POST /api/auth/mfa/enable` - Ativar MFA
  - Requer: Autenticação
  - Body: `{ mfaCode }`

## 👥 Pacientes (`/api/patients`)

### RF005 - Cadastro de Paciente
- `POST /api/patients` - Criar paciente
  - Requer: Autenticação + Permissão `createPatient` (Coordenador, Administrador)
  - Body: Dados do paciente conforme Patient Model

- `GET /api/patients` - Listar pacientes
  - Requer: Autenticação
  - Query: `?patientName=...&clinicalUnit=...&limit=50&skip=0`

- `GET /api/patients/:id` - Buscar paciente por ID
  - Requer: Autenticação

- `PUT /api/patients/:id` - Atualizar paciente
  - Requer: Autenticação + Permissão `createPatient`

## 📦 Importação (`/api/import`)

### RF007 - Upload e Importação de Dados
- `POST /api/import/validate` - Validar arquivo antes de importar
  - Requer: Autenticação + Permissão `uploadFiles`
  - FormData: `file`, `dataType` (patients|samples|results|temperature)
  - Retorna: Validação da estrutura

- `POST /api/import/import` - Importar dados
  - Requer: Autenticação + Permissão `uploadFiles`
  - FormData: `file`, `dataType`
  - Retorna: `{ success, errors, total }`

**Tipos suportados:**
- `patients`: CSV, JSON
- `samples`: CSV, JSON
- `results`: ZIP, RAW, CSV (pendente)
- `temperature`: CSV

## 🌡️ Temperatura (`/api/temperature`)

### RF009 - Registro de Temperatura
- `POST /api/temperature/reading` - Registrar leitura de temperatura
  - Requer: Autenticação + Permissão `viewTemperature`
  - Body: Dados de temperatura conforme Temperature Model

- `POST /api/temperature/system/reading` - Registro automático pelo sistema
  - Não requer autenticação de usuário (para IoT/sensores)

- `GET /api/temperature/history` - Histórico de temperatura
  - Requer: Autenticação + Permissão `viewTemperature`
  - Query: `?sensorId=...&startDate=...&endDate=...&limit=1000&skip=0`

- `GET /api/temperature/alerts` - Alertas ativos
  - Requer: Autenticação + Permissão `viewTemperature`

## 🔧 Sensores (`/api/sensors`)

### RF009 - Gerenciamento de Sensores
- `POST /api/sensors` - Criar sensor
  - Requer: Autenticação + Permissão `viewTemperature`
  - Body: Dados do sensor conforme Sensor Model

- `GET /api/sensors` - Listar sensores
  - Requer: Autenticação + Permissão `viewTemperature`
  - Query: `?locationId=...&maintenanceStatus=...&limit=50&skip=0`

- `GET /api/sensors/:id` - Buscar sensor por ID
  - Requer: Autenticação + Permissão `viewTemperature`

- `POST /api/sensors/:id/reading` - Coletar leitura do sensor
  - Requer: Autenticação + Permissão `viewTemperature`

## 🤖 Assistente Inteligente (`/api/assistant`)

### RF011 - Assistente Inteligente (IA)
- `POST /api/assistant/question` - Responder pergunta
  - Autenticação opcional
  - Body: `{ question, contextScope? }`
  - Retorna: `{ answer, contextScope, modelVersion }`

- `POST /api/assistant/suggest` - Sugerir ações
  - Autenticação opcional
  - Body: `{ screenID }`
  - Retorna: `{ screenID, userRole, suggestions }`

- `POST /api/assistant/tutorial` - Iniciar tutorial passo a passo
  - Autenticação opcional
  - Body: `{ flowID }`
  - Retorna: `{ flowID, tutorial: { steps, title } }`

## 📊 Outras Rotas

- `GET /api/health` - Health check
  - Não requer autenticação
  - Retorna: Status do servidor e banco de dados

## 🔒 Permissões (RBAC)

### Roles:
- `1` = UsuarioExterno
- `2` = Tecnico
- `3` = Coordenador
- `4` = Administrador

### Permissões por Funcionalidade:
- `createUser`: Coordenador, Administrador
- `createSample`: Técnico, Coordenador, Administrador
- `createPatient`: Coordenador, Administrador
- `withdrawSample`: Técnico, Coordenador, Administrador
- `uploadFiles`: Técnico, Coordenador, Administrador
- `viewReports`: Todos
- `viewTemperature`: Técnico, Coordenador, Administrador
- `manageBackup`: Administrador
- `useAssistant`: Todos
- `manageSystem`: Administrador

## 📝 Formato de Respostas

### Sucesso:
```json
{
  "success": true,
  "message": "Operação realizada com sucesso",
  "data": { ... }
}
```

### Erro:
```json
{
  "success": false,
  "error": "Tipo de erro",
  "message": "Descrição detalhada do erro"
}
```

## 🔑 Autenticação

Todas as rotas protegidas requerem header:
```
Authorization: Bearer <token>
```

O token é obtido através de `POST /api/auth/login`.

