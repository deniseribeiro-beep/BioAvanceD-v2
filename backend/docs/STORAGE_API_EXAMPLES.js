/**
 * STORAGE API - Exemplos de Uso
 * ISO 20387 - Núcleo de Armazenamento Físico
 * Data: Feb 12, 2026 (Semana 2)
 *
 * Base URL: http://localhost:3000/api/storage
 *
 * Todos os endpoints requerem autenticação (JWT Token)
 * Header: Authorization: Bearer <token>
 */

// ============================================================================
// 1. VALIDAR DISPONIBILIDADE DE POSIÇÃO (sem alocar)
// ============================================================================

// GET /api/storage/validate/:boxId/:position
// Verifica se uma posição está disponível

/**
 * EXEMPLO 1A: Posição disponível
 * GET /api/storage/validate/507f1f77bcf86cd799439012/A1
 *
 * Response 200:
 */
{
  "success": true,
  "available": true,
  "boxData": {
    "boxId": "507f1f77bcf86cd799439012",
    "boxName": "Box A1-01",
    "dimension": { "rows": 9, "cols": 9 },
    "currentOccupancy": 5,
    "capacity": 81,
    "availablePositions": 76
  }
}

/**
 * EXEMPLO 1B: Posição fora do intervalo (9x9 não tem J1)
 * GET /api/storage/validate/507f1f77bcf86cd799439012/J1
 *
 * Response 409:
 */
{
  "success": false,
  "available": false,
  "error": "POSITION_OUT_OF_BOUNDS_ROW",
  "message": "Posição 'J1' fora do intervalo. Linhas válidas: A até I"
}

/**
 * EXEMPLO 1C: COLISÃO - Posição ocupada
 * GET /api/storage/validate/507f1f77bcf86cd799439012/B2
 *
 * Response 409:
 */
{
  "success": false,
  "available": false,
  "error": "STORAGE_COLLISION",
  "message": "Posição 'B2' já está ocupada por amostra 507f1f77bcf86cd799439055",
  "occupiedBySampleId": "507f1f77bcf86cd799439055"
}

// ============================================================================
// 2. ALOCAR AMOSTRA A UMA POSIÇÃO
// ============================================================================

// POST /api/storage/allocate
// Aloca uma amostra a uma posição (operação ATÔMICA)

/**
 * Request Body:
 */
{
  "sampleId": "507f1f77bcf86cd799439011",
  "boxId": "507f1f77bcf86cd799439012",
  "position": "A1"
}

/**
 * Response 201 (Sucesso):
 */
{
  "success": true,
  "data": {
    "sampleId": "507f1f77bcf86cd799439011",
    "boxId": "507f1f77bcf86cd799439012",
    "position": "A1"
  },
  "message": "Amostra alocada com sucesso em A1"
}

/**
 * Response 409 (Colisão):
 */
{
  "success": false,
  "error": "STORAGE_COLLISION",
  "message": "Posição 'A1' já está ocupada por amostra 507f1f77bcf86cd799439055",
  "occupiedBySampleId": "507f1f77bcf86cd799439055"
}

// ============================================================================
// 3. VERIFICAR LOCALIZAÇÃO DE UMA AMOSTRA
// ============================================================================

// GET /api/storage/sample/:sampleId
// Retorna onde uma amostra está armazenada

/**
 * GET /api/storage/sample/507f1f77bcf86cd799439011
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "sampleId": "507f1f77bcf86cd799439011",
    "barcode": "BA123456789",
    "box": {
      "boxId": "507f1f77bcf86cd799439012",
      "position": "A1"
    },
    "path": "Ultra-Freezer 01/Prateleira 1/Rack A/Box A1-01",
    "fullHierarchy": {
      "freezerId": "507f1f77bcf86cd799439000",
      "shelfId": "507f1f77bcf86cd799439001",
      "rackId": "507f1f77bcf86cd799439002",
      "boxId": "507f1f77bcf86cd799439012"
    }
  }
}

// ============================================================================
// 4. LISTAR POSIÇÕES DISPONÍVEIS EM UMA CAIXA
// ============================================================================

// GET /api/storage/box/:boxId/available
// Lista todas as posições vazias em uma caixa

/**
 * GET /api/storage/box/507f1f77bcf86cd799439012/available
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "boxId": "507f1f77bcf86cd799439012",
    "boxName": "Box A1-01",
    "dimension": { "rows": 9, "cols": 9 },
    "stats": {
      "capacity": 81,
      "occupied": 5,
      "available": 76,
      "occupancyPercent": 6
    },
    "availablePositions": [
      "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9",
      "B1", "B2", "B3", ..., "I9"
    ],
    "occupiedPositions": [
      "B1", "C2", "D5", "E7", "F3"
    ]
  }
}

// ============================================================================
// 5. LIBERAR AMOSTRA DE UMA POSIÇÃO
// ============================================================================

// DELETE /api/storage/release/:sampleId
// Remove amostra de uma posição (e libera espaço)

/**
 * DELETE /api/storage/release/507f1f77bcf86cd799439011
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "sampleId": "507f1f77bcf86cd799439011",
    "boxId": "507f1f77bcf86cd799439012",
    "position": "A1"
  },
  "message": "Amostra liberada de A1"
}

// ============================================================================
// 6. OBTER ÁRVORE HIERÁRQUICA DO FREEZER
// ============================================================================

// GET /api/storage/freezer/:freezerId/tree
// Visualização completa: Freezer → Shelves → Racks → Boxes + Stats

/**
 * GET /api/storage/freezer/507f1f77bcf86cd799439000/tree
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "freezerId": "507f1f77bcf86cd799439000",
    "freezerName": "Ultra-Freezer 01",
    "temperature": -80,
    "temperatureUnit": "CELSIUS",
    "status": "OPERATIONAL",
    "shelves": [
      {
        "shelfId": "507f1f77bcf86cd799439001",
        "shelfName": "Prateleira 1",
        "racks": [
          {
            "rackId": "507f1f77bcf86cd799439002",
            "rackName": "Rack A",
            "boxes": [
              {
                "boxId": "507f1f77bcf86cd799439012",
                "boxName": "Box A1-01",
                "dimension": { "rows": 9, "cols": 9 },
                "stats": {
                  "capacity": 81,
                  "occupied": 5,
                  "available": 76,
                  "occupancyPercent": 6
                },
                "status": "ACTIVE"
              },
              {
                "boxId": "507f1f77bcf86cd799439013",
                "boxName": "Box A1-02",
                "dimension": { "rows": 9, "cols": 9 },
                "stats": {
                  "capacity": 81,
                  "occupied": 81,
                  "available": 0,
                  "occupancyPercent": 100
                },
                "status": "FULL"
              }
            ],
            "stats": {
              "boxes": 10,
              "totalCapacity": 810,
              "totalOccupied": 125
            }
          }
        ],
        "stats": {
          "racks": 5,
          "boxes": 50,
          "totalCapacity": 4050,
          "totalOccupied": 625
        }
      },
      {
        "shelfId": "507f1f77bcf86cd799439003",
        "shelfName": "Prateleira 2",
        "racks": [...],
        "stats": { ... }
      }
    ],
    "aggregateStats": {
      "totalShelves": 2,
      "totalRacks": 10,
      "totalBoxes": 100,
      "totalCapacity": 8100,
      "totalOccupied": 1250,
      "totalAvailable": 6850,
      "occupancyPercent": 15
    }
  }
}

// ============================================================================
// 7. ESTATÍSTICAS DE OCUPAÇÃO
// ============================================================================

// GET /api/storage/freezer/:freezerId/stats
// Estatísticas agregadas por Rack

/**
 * GET /api/storage/freezer/507f1f77bcf86cd799439000/stats
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "freezerId": "507f1f77bcf86cd799439000",
    "freezerName": "Ultra-Freezer 01",
    "temperature": -80,
    "rackStats": [
      {
        "_id": "507f1f77bcf86cd799439002",
        "rackName": "Rack A",
        "totalCapacity": 810,
        "totalOccupied": 125
      },
      {
        "_id": "507f1f77bcf86cd799439003",
        "rackName": "Rack B",
        "totalCapacity": 810,
        "totalOccupied": 250
      }
    ],
    "aggregate": {
      "totalCapacity": 8100,
      "totalOccupied": 1250,
      "totalAvailable": 6850,
      "occupancyPercent": 15
    }
  }
}

// ============================================================================
// 8. VERIFICAÇÃO DE INTEGRIDADE (AUDITORIA)
// ============================================================================

// GET /api/storage/box/:boxId/integrity
// Verifica inconsistências, órfãos e contagens

/**
 * EXEMPLO 8A: Box OK
 * GET /api/storage/box/507f1f77bcf86cd799439012/integrity
 *
 * Response 200:
 */
{
  "success": true,
  "data": {
    "valid": true,
    "stats": {
      "boxId": "507f1f77bcf86cd799439012",
      "dimension": { "rows": 9, "cols": 9 },
      "capacity": 81,
      "currentOccupancy": 5,
      "actualOccupancy": 5
    }
  }
}

/**
 * EXEMPLO 8B: Box COM INCONSISTÊNCIAS (órfãos detectados)
 * GET /api/storage/box/507f1f77bcf86cd799439012/integrity
 *
 * Response 400:
 */
{
  "success": false,
  "data": {
    "valid": false,
    "errors": [
      "Orfão: posição A1 referencia amostra inexistente 507f1f77bcf86cd799449999",
      "Inconsistência: currentOccupancy=5, mas ocupação real=4"
    ],
    "stats": {
      "boxId": "507f1f77bcf86cd799439012",
      "dimension": { "rows": 9, "cols": 9 },
      "capacity": 81,
      "currentOccupancy": 5,
      "actualOccupancy": 4
    }
  }
}

// ============================================================================
// CURL EXAMPLES
// ============================================================================

/*
# 1. Listar posições disponíveis
curl -X GET "http://localhost:3000/api/storage/box/507f1f77bcf86cd799439012/available" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 2. Validar posição
curl -X GET "http://localhost:3000/api/storage/validate/507f1f77bcf86cd799439012/A1" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Alocar amostra
curl -X POST "http://localhost:3000/api/storage/allocate" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sampleId": "507f1f77bcf86cd799439011",
    "boxId": "507f1f77bcf86cd799439012",
    "position": "A1"
  }'

# 4. Ver localização de amostra
curl -X GET "http://localhost:3000/api/storage/sample/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. Liberar amostra
curl -X DELETE "http://localhost:3000/api/storage/release/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 6. Ver árvore do freezer
curl -X GET "http://localhost:3000/api/storage/freezer/507f1f77bcf86cd799439000/tree" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 7. Ver stats de freezer
curl -X GET "http://localhost:3000/api/storage/freezer/507f1f77bcf86cd799439000/stats" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 8. Verificar integridade
curl -X GET "http://localhost:3000/api/storage/box/507f1f77bcf86cd799439012/integrity" \
  -H "Authorization: Bearer YOUR_TOKEN"
*/

// ============================================================================
// CÓDIGOS DE ERRO
// ============================================================================

const ERROR_CODES = {
  // 400 - Validação/Entrada
  INVALID_REQUEST: "Parâmetros obrigatórios faltando",
  INVALID_INPUT: "Entrada inválida (formato, tipo, etc)",
  INVALID_POSITION_FORMAT: "Formato de posição inválido (ex: A1, B4)",
  POSITION_OUT_OF_BOUNDS_ROW: "Linha fora do intervalo (máximo até Z)",
  POSITION_OUT_OF_BOUNDS_COL: "Coluna fora do intervalo",
  NO_STORAGE_LOCATION: "Amostra sem localização de armazenamento",

  // 404 - Não encontrado
  SAMPLE_NOT_FOUND: "Amostra não encontrada",
  BOX_NOT_FOUND: "StorageBox não encontrada",
  FREEZER_NOT_FOUND: "Freezer não encontrado",

  // 409 - Conflito
  STORAGE_COLLISION: "Posição já está ocupada (colisão detectada)",

  // 500 - Erro interno
  INTERNAL_ERROR: "Erro interno do servidor",
  ALLOCATION_ERROR: "Erro ao alocar amostra",
  RELEASE_ERROR: "Erro ao liberar posição",
  QUERY_ERROR: "Erro ao buscar dados",
  STATS_ERROR: "Erro ao calcular estatísticas",
  INTEGRITY_CHECK_ERROR: "Erro ao verificar integridade"
};

module.exports = {
  ERROR_CODES
};
