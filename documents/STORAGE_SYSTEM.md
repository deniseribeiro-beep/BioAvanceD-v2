# 📦 Storage System (Núcleo de Armazenamento Físico)

**Data**: Fevereiro 12, 2026  
**Semana**: 2 - Desenvolvimento do BioAvanceD  
**Padrão**: ISO 20387 (Norma de Biobanco)  
**Status**: ✅ IMPLEMENTADO COMPLETO (PASSO 1, 2, 3)

---

## 📋 Resumo Executivo

Sistema **robusto e atômico** para gerenciar a localização física de amostras biológicas em freezers. Implementa:

✅ **Estrutura Hierárquica**:
- Freezer (Ex: "Ultra-Freezer 01", -80°C)
- Shelf (Prateleira dentro do freezer)
- Rack (Estrutura metálica na prateleira)
- Box (Caixa com grid, ex: 9×9 ou 10×10)
- Position (Coordenada: A1, B4, I9, etc)

✅ **Prevenção de Colisão de Armazenagem** (STORAGE_COLLISION):
- Validação: posição cabe nas dimensões da caixa?
- Validação: posição já está ocupada?
- Validação: formato da posição é válido (letra+número)?

✅ **Operações Atômicas (ACID)**:
- Transações MongoDB (2-phase commit)
- Box + Sample + Auditoria atualizados em sincronia
- Sem posições órfãs

✅ **Auditoria Completa**:
- SampleMovement imutável (ledger)
- Rastreamento de alocações/liberações
- Verificação de integridade (orphan detection)

---

## 🏗️ Arquitetura

### Modelos Mongoose (PASSO 1)

#### **StorageContainer** (arquivo: `src/models/StorageContainer.js`)
Hierarquia: FREEZER ← SHELF ← RACK

```javascript
{
  _id: ObjectId,
  containerType: "FREEZER" | "SHELF" | "RACK",
  name: "Ultra-Freezer 01",
  parent_id: ObjectId | null,  // null para FREEZER
  temperature: -80,            // only for FREEZER
  capacity: número,
  status: "OPERATIONAL" | "MAINTENANCE" | "RETIRED"
}
```

#### **StorageBox** (arquivo: `src/models/StorageBox.js`)
Caixa com grid de posições

```javascript
{
  _id: ObjectId,
  name: "Box A1-01",
  parent_id: ObjectId,         // Rack ID
  dimension: { rows: 9, cols: 9 },
  occupancyGrid: Map<string, ObjectId>,  // "A1" → sampleID
  currentOccupancy: 5,
  status: "ACTIVE" | "FULL" | "RETIRED"
}
```

#### **StoragePath** (arquivo: `src/models/StoragePath.js`)
Índice hierárquico (otimizado para queries)

```javascript
{
  _id: ObjectId,
  boxId: ObjectId,
  freezerId: ObjectId,
  shelfId: ObjectId,
  rackId: ObjectId,
  path: "Freezer01/Shelf1/RackA/Box01"
}
```

#### **Sample.js** (modificado)
Campo novo:

```javascript
storageLocation: {
  boxId: ObjectId,      // Referência para StorageBox._id
  position: String      // Ex: "A1", "B4", "I9"
}
```

---

### Service Layer (PASSO 2)

**Arquivo**: `src/services/storageService.js`

```javascript
class StorageService {
  // ⭐ FUNÇÃO PRINCIPAL: Collision Detector
  async validatePositionAvailability(boxId, position)
    // Verifica 3 coisas:
    // 1. Formato válido (A1, B4, etc)
    // 2. Posição dentro das dimensões
    // 3. Sem colisão ↔ posição vazia

  // Alocação atômica (transação ACID)
  async allocateSampleToPosition(sampleId, boxId, position)
    // 1. Valida
    // 2. Update Box.occupancyGrid
    // 3. Update Sample.storageLocation
    // 4. Cria SampleMovement (auditoria)
    // Tudo em uma transação

  // Liberar posição
  async releaseSampleFromPosition(sampleId)

  // Buscar primeira posição disponível
  async findAvailablePosition(boxId)

  // Obter localização de amostra
  async getSampleStorage(sampleId)

  // Verificar integridade (auditoria)
  async verifyBoxIntegrity(boxId)
    // Detecta órfãos, inconsistências

  // Estatísticas de ocupação
  async getFreezerOccupancyStats(freezerId)
}
```

---

### Controller + Rotas (PASSO 3)

**Arquivo**: `src/controllers/storage.controller.js`  
**Rotas**: `src/routes/storage.routes.js`

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| **POST** | `/api/storage/allocate` | Alocar amostra a posição |
| **DELETE** | `/api/storage/release/:sampleId` | Liberar amostra |
| **GET** | `/api/storage/sample/:sampleId` | Ver localização de amostra |
| **GET** | `/api/storage/box/:boxId/available` | Listar posições vazias |
| **GET** | `/api/storage/validate/:boxId/:position` | Validar sem alocar |
| **GET** | `/api/storage/freezer/:freezerId/tree` | Árvore hierárquica |
| **GET** | `/api/storage/freezer/:freezerId/stats` | Estatísticas de ocupação |
| **GET** | `/api/storage/box/:boxId/integrity` | Verificar integridade |

---

## 🔒 Segurança & Integridade

### Transações ACID

```javascript
// Exemplo: Alocação atômica
session.withTransaction(async () => {
  // Validação de colisão
  // ↓
  // Update Box (adiciona sample ao occupancyGrid)
  // ↓
  // Update Sample (registra storageLocation)
  // ↓
  // Insert SampleMovement (auditoria)
  // Se falhar em qualquer passo → rollback tudo
});
```

### Prevenção de Race Conditions

```javascript
// Usa match condition no update
db.storageBoxes.updateOne(
  {
    _id: boxId,
    [`occupancyGrid.${position}`]: { $exists: false }  // ← atomic check
  },
  {
    $set: { [`occupancyGrid.${position}`]: sampleId }
  }
);
// Se posição foi ocupada entre validação e update → falha
```

### Auditoria Completa

Cada alocação/liberação cria registro imutável:

```javascript
{
  sampleID: ObjectId,
  type: "allocate" | "release",
  timestamp: Date,
  storageAction: {
    boxId: ObjectId,
    position: string
  },
  responsible: "SYSTEM"
}
```

---

## 📚 Exemplos de Uso

### 1️⃣ **Validar Posição (Drill)**

```bash
curl -X GET "http://localhost:3000/api/storage/validate/boxId/A1" \
  -H "Authorization: Bearer TOKEN"
```

**Response** (posição disponível):
```json
{
  "success": true,
  "available": true,
  "boxData": { ... }
}
```

**Response** (colisão):
```json
{
  "success": false,
  "available": false,
  "error": "STORAGE_COLLISION",
  "message": "Posição 'A1' já está ocupada",
  "occupiedBySampleId": "507f..."
}
```

### 2️⃣ **Alocar Amostra**

```bash
curl -X POST "http://localhost:3000/api/storage/allocate" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleId": "507f...",
    "boxId": "507f...",
    "position": "A1"
  }'
```

**Response**:
```json
{
  "success": true,
  "data": {
    "sampleId": "507f...",
    "boxId": "507f...",
    "position": "A1"
  },
  "message": "Amostra alocada com sucesso em A1"
}
```

### 3️⃣ **Ver Localização de Amostra**

```bash
curl -X GET "http://localhost:3000/api/storage/sample/507f..." \
  -H "Authorization: Bearer TOKEN"
```

**Response**:
```json
{
  "success": true,
  "data": {
    "sampleId": "507f...",
    "box": {
      "boxId": "507f...",
      "position": "A1"
    },
    "path": "Freezer01 / Shelf1 / RackA / Box01",
    "fullHierarchy": { ... }
  }
}
```

### 4️⃣ **Listar Posições Disponíveis**

```bash
curl -X GET "http://localhost:3000/api/storage/box/507f.../available" \
  -H "Authorization: Bearer TOKEN"
```

**Response**:
```json
{
  "success": true,
  "data": {
    "boxId": "507f...",
    "stats": {
      "capacity": 81,
      "occupied": 5,
      "available": 76,
      "occupancyPercent": 6
    },
    "availablePositions": ["A1", "A2", "A3", ..., "I9"]
  }
}
```

### 5️⃣ **Árvore Hierárquica do Freezer**

```bash
curl -X GET "http://localhost:3000/api/storage/freezer/507f.../tree" \
  -H "Authorization: Bearer TOKEN"
```

**Response**:
```json
{
  "success": true,
  "data": {
    "freezerName": "Ultra-Freezer 01",
    "temperature": -80,
    "shelves": [
      {
        "shelfName": "Prateleira 1",
        "racks": [
          {
            "rackName": "Rack A",
            "boxes": [
              {
                "boxName": "Box A1-01",
                "dimension": { "rows": 9, "cols": 9 },
                "stats": {
                  "capacity": 81,
                  "occupied": 5,
                  "available": 76,
                  "occupancyPercent": 6
                }
              }
            ]
          }
        ]
      }
    ],
    "aggregateStats": {
      "totalCapacity": 8100,
      "totalOccupied": 1250,
      "occupancyPercent": 15
    }
  }
}
```

### 6️⃣ **Verificar Integridade**

```bash
curl -X GET "http://localhost:3000/api/storage/box/507f.../integrity" \
  -H "Authorization: Bearer TOKEN"
```

**Response** (OK):
```json
{
  "success": true,
  "data": {
    "valid": true,
    "stats": {
      "capacity": 81,
      "currentOccupancy": 5,
      "actualOccupancy": 5
    }
  }
}
```

**Response** (com inconsistências):
```json
{
  "success": false,
  "data": {
    "valid": false,
    "errors": [
      "Orfão: posição A1 referencia amostra inexistente 507f...",
      "Inconsistência: currentOccupancy=5, mas ocupação real=4"
    ]
  }
}
```

---

## 🚀 Como Testar

### Setup Inicial

```bash
# 1. Certifique-se de que os modelos estão carregados
node backend/scripts/create-db.js

# 2. Rodas a migração (adiciona storageLocation a amostras existentes)
node backend/scripts/migrate-storage-location.js

# 3. Inicie o servidor
npm start
```

### Teste Rápido

```javascript
// Em um script de teste
const StorageService = require('./src/services/storageService');

const service = new StorageService(db);

// Testar validação de colisão
const result = await service.validatePositionAvailability(boxId, "A1");
console.log(result);

// Testar alocação
const alloc = await service.allocateSampleToPosition(sampleId, boxId, "A1");
console.log(alloc);

// Testar liberação
const release = await service.releaseSampleFromPosition(sampleId);
console.log(release);
```

---

## 📊 Performance

### Índices Criados

```javascript
// StorageBoxes
db.storageBoxes.createIndex({ parent_id: 1, status: 1 })
db.storageBoxes.createIndex({ boxID: 1 })  // unique

// StorageContainers
db.storageContainers.createIndex({ containerType: 1, status: 1 })
db.storageContainers.createIndex({ parent_id: 1, containerType: 1 })

// Samples (novo)
db.amostras.createIndex({ 'storageLocation.boxId': 1 })
db.amostras.createIndex({ 'storageLocation.position': 1 })
```

### Queries Otimizadas

- ✅ Buscar amostras em uma caixa: **O(1)** com Map
- ✅ Validar colisão: **O(1)** - lookup em Map
- ✅ Listar disponíveis: **O(n)** onde n = dimensões caixa (máx 100)
- ✅ Árvore hierárquica: **O(SRB)** agregação por Shelf/Rack/Box

---

## 🔍 Troubleshooting

### ❌ "STORAGE_COLLISION"

**Causa**: Posição já está ocupada  
**Solução**: 
1. Verificar com `GET /api/storage/box/:boxId/available`
2. Usar `POST /api/storage/allocate` com posição diferente
3. Liberar amostra com `DELETE /api/storage/release/:sampleId`

### ❌ "POSITION_OUT_OF_BOUNDS"

**Causa**: Posição fora das dimensões (ex: J1 em 9×9)  
**Solução**: Usar posição entre A-I e 1-9

### ❌ "BOX_NOT_FOUND"

**Causa**: BoxId inválido ou não existe  
**Solução**: Verificar BoxId com `GET /api/storage/box/:boxId/available`

### ❌ Integridade violada

**Solução**: Executar `GET /api/storage/box/:boxId/integrity` para identificar órfãos

---

## 📝 Próximos Passos (Semana 3+)

- [ ] Frontend: Visualizador interativo de árvore (React)
- [ ] QR Code: Gerar QR para cada posição
- [ ] Impressão: Etiquetas para caixas/posições
- [ ] Dashboard: Monitoramento de ocupação
- [ ] Alertas: Caixas FULL sugerem criar nova
- [ ] Relatórios: Análise de distribuição

---

## 📚 Referências

- **ISO 20387**: Biobanking - General requirements for quality and competence
- **FHIR**: Specimen location tracking
- **MongoDB Transactions**: https://docs.mongodb.com/manual/core/transactions/
- **BioAvanceD Architecture**: `documents/ARCHITECTURE.md`

---

**Autor**: Engenheiro de Dados Sênior  
**Data**: Fevereiro 12, 2026  
**Status**: ✅ COMPLETO E TESTADO
