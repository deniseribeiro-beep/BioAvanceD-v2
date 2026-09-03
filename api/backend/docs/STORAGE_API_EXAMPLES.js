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
    "specimenId": "507f1f77bcf86cd799439011",
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
// 3. ALOCAR AMOSTRA AUTOMATICAMENTE (PRÓXIMA POSIÇÃO VAZIA)
// ============================================================================

// POST /api/storage/allocate/auto
// Aloca a amostra na primeira posição vazia (leitura row-major, ex: A1, A2...)
// da caixa informada, em vez de o chamador escolher a posição.
// Fonte: storage.routes.js:165-207, auto-assign-sample.controller.js,
// storageService.js:79-280 (StorageService.autoAssignSampleToBox).

/**
 * Request Body:
 */
{
  "sampleId": "507f1f77bcf86cd799439011",
  "boxId": "507f1f77bcf86cd799439012"
}

/**
 * Response 201 (Sucesso):
 *
 * NOTA sobre a chave da resposta: o campo é "specimenId", não "sampleId",
 * mesmo o corpo da requisição usando "sampleId"
 * (storageService.js:254-258 monta sampleLocation com "specimenId").
 * Isto NÃO é uma particularidade deste endpoint: o mesmo já acontece em
 * POST /allocate (AllocateSampleUseCase.js:106-110) e em
 * DELETE /release/:sampleId (ReleaseSampleUseCase.js:63-64) -- os três
 * devolvem "specimenId" em produção, de forma consistente. Os blocos
 * "2. ALOCAR AMOSTRA" acima e "7. LIBERAR AMOSTRA" abaixo mostravam
 * "sampleId" e foram corrigidos junto com esta issue (#1016): quem
 * escrevesse um cliente a partir deles leria a chave errada.
 */
{
  "success": true,
  "data": {
    "specimenId": "507f1f77bcf86cd799439011",
    "boxId": "507f1f77bcf86cd799439012",
    "position": "A1"
  },
  "message": "Amostra alocada automaticamente na Posição A1",
  "graphPersisted": true
}

/**
 * Response 400 (Entrada inválida):
 */
{
  "success": false,
  "error": "INVALID_INPUT",
  "message": "sampleId e boxId são obrigatórios"
}

/**
 * Response 404 (Amostra ou caixa inexistente):
 */
{
  "success": false,
  "error": "SAMPLE_NOT_FOUND",
  "message": "Amostra 507f1f77bcf86cd799439011 não encontrada"
}

/**
 * Response 409 (Já alocada / caixa cheia):
 */
{
  "success": false,
  "error": "ALREADY_ALLOCATED",
  "message": "Amostra já está alocada em 507f.../A1"
}
{
  "success": false,
  "error": "BOX_FULL",
  "message": "Nenhuma posição disponível nesta box"
}

// ============================================================================
// 4. MOVER AMOSTRA ENTRE POSIÇÕES
// ============================================================================

// POST /api/storage/move
// Move uma amostra já alocada de uma posição para outra (transação Mongo +
// evento de auditoria imutável). Fonte: storage.routes.js:209-222,
// move-sample.controller.js, MoveSampleUseCase.js.

/**
 * Request Body:
 */
{
  "sampleId": "507f1f77bcf86cd799439011",
  "targetBoxId": "507f1f77bcf86cd799439012",
  "targetPosition": "A1",
  "reason": "Reorganização de layout",
  "notes": "Movido durante inventário"
}

/**
 * Response 200 (Sucesso):
 * (MoveSampleUseCase.js:156-167 -- data é o retorno cru do caso de uso, não
 * um sampleLocation; note também "specimenId" aqui, não "sampleId".)
 */
{
  "success": true,
  "data": {
    "movementID": 42,
    "specimenId": "507f1f77bcf86cd799439011",
    "from": { "boxId": "507f1f77bcf86cd799439012", "position": "A1" },
    "to": { "boxId": "507f1f77bcf86cd799439013", "position": "B2" },
    "movedAt": "2026-02-12T10:00:00.000Z",
    "lineageSynced": true,
    "lineageValidated": true,
    "lineagePersisted": true,
    "lineageEventId": "..."
  },
  "message": "Amostra movida com sucesso"
}

/**
 * Response 404/409/400/500 -- código de erro único (MOVE_SAMPLE_ERROR) com
 * status derivado da mensagem lançada pelo use case. Ver o comentário de
 * MOVE_SAMPLE_ERROR na tabela ERROR_CODES abaixo e
 * move-sample.controller.js:74-101.
 */
{
  "success": false,
  "error": "MOVE_SAMPLE_ERROR",
  "message": "Amostra não encontrada"
}

// ============================================================================
// 5. VERIFICAR LOCALIZAÇÃO DE UMA AMOSTRA
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
    "specimenId": "507f1f77bcf86cd799439011",
    "barcode": "BA123456789",
    "box": {
      "boxId": "507f1f77bcf86cd799439012",
      "boxName": "Box A1-01",
      "position": "A1"
    },
    "locationID": "LOC-0001",
    "readable": "Ultra-Freezer 01 / Prateleira 1 / Rack A / Box A1-01 / A1",
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
// 6. LISTAR POSIÇÕES DISPONÍVEIS EM UMA CAIXA
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
// 7. LIBERAR AMOSTRA DE UMA POSIÇÃO
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
    "specimenId": "507f1f77bcf86cd799439011",
    "boxId": "507f1f77bcf86cd799439012",
    "position": "A1"
  },
  "message": "Amostra liberada de A1"
}

// ============================================================================
// 8. OBTER ÁRVORE HIERÁRQUICA DO FREEZER
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
// 9. ESTATÍSTICAS DE OCUPAÇÃO
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
// 10. VERIFICAÇÃO DE INTEGRIDADE (AUDITORIA)
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
// 11. LISTAR FREEZERS OPERACIONAIS
// ============================================================================

// GET /api/storage/freezers
// Lista todos os freezers com status OPERATIONAL.
// Fonte: storage.routes.js:79-99, storage-query.controller.js:14-33,
// ListOperationalFreezersUseCase.js.

/**
 * GET /api/storage/freezers
 *
 * Response 200:
 */
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439000",
      "containerID": 1,
      "name": "Ultra-Freezer 01",
      "temperature": -80,
      "temperatureUnit": "CELSIUS",
      "status": "OPERATIONAL"
    }
  ]
}

// ============================================================================
// 12. BUSCAR AMOSTRAS ALOCÁVEIS
// ============================================================================

// GET /api/storage/samples/search?q=termo
// Busca amostras ainda não alocadas (sem storageLocation.boxId), com
// currentStatus em Available/Registered/pending, enriquecidas com o status
// de consentimento do paciente.
// Fonte: storage.routes.js:101-130, storage-query.controller.js:35-55,
// SearchAllocatableSamplesUseCase.js.

/**
 * GET /api/storage/samples/search?q=BR-2025-001
 *
 * Response 200:
 */
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "barcode": "BR-2025-001",
      "patientID": "10732282",
      "sampleType": "Sangue",
      "currentStatus": "Available",
      "consentValid": true,
      "consentMessage": "Consentimento ativo",
      "canAllocate": true
    }
  ]
}

// ============================================================================
// 13. ATRIBUIR ROOM A UM FREEZER
// ============================================================================

// PATCH /api/storage/freezer/:freezerId/room
// Atribui (ou remove, com roomId null) a Room de um container do tipo
// FREEZER. Fonte: storage.routes.js:466-560 (handler inline, não passa por
// um controller dedicado).

/**
 * Request Body:
 */
{
  "roomId": "507f1f77bcf86cd799439012"
}

/**
 * Response 200 (Sucesso):
 */
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439000",
    "roomId": "507f1f77bcf86cd799439012"
  }
}

/**
 * Response 404 (storage.routes.js:505-507, :523-526):
 */
{
  "success": false,
  "error": "FREEZER_NOT_FOUND"
}
{
  "success": false,
  "error": "ROOM_NOT_FOUND"
}

/**
 * Response 400 (container não é FREEZER -- storage.routes.js:508-514):
 */
{
  "success": false,
  "error": "NOT_A_FREEZER",
  "message": "roomId só pode ser atribuído a containers do tipo FREEZER"
}

/**
 * Response 400 (falha inesperada -- storage.routes.js:552-559).
 * NOTA: ao contrário dos outros endpoints deste arquivo, o catch desta rota
 * devolve status 400 (não 500) com error "INTERNAL_ERROR" para QUALQUER
 * exceção não tratada, incluindo falhas de infraestrutura. Documentado como
 * está no código, não como deveria ser -- ver issue de acompanhamento
 * sugerida no fechamento desta issue (#1016).
 */
{
  "success": false,
  "error": "INTERNAL_ERROR",
  "message": "..."
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
  NOT_A_FREEZER: "Container não é do tipo FREEZER (PATCH /freezer/:freezerId/room, storage.routes.js:508-514)",

  // NO_STORAGE_LOCATION is INTERNAL-ONLY and unreachable through any route.
  // It is emitted solely by StorageService.releaseSampleFromPosition
  // (storageService.js:289-364, the code itself at :315), a method with no
  // production caller -- confirmed via `git grep -n releaseSampleFromPosition`
  // across the tracked tree, which turns up only its own definition and its
  // unit tests (tests/unit/storageService.test.js). DELETE
  // /release/:sampleId, the route this method's name suggests it backs,
  // actually routes through ReleaseSampleUseCase and surfaces RELEASE_ERROR
  // (see below) instead. Kept in this table rather than deleted, because the
  // dead method still exists and a future direct caller of the service would
  // still see this code.
  NO_STORAGE_LOCATION: "Amostra sem localização de armazenamento -- dead code path (ver nota acima); DELETE /release/:sampleId devolve RELEASE_ERROR, nunca este código",

  // 404 - Não encontrado
  SAMPLE_NOT_FOUND: "Amostra não encontrada",
  BOX_NOT_FOUND: "StorageBox não encontrada",
  FREEZER_NOT_FOUND: "Freezer não encontrado",
  ROOM_NOT_FOUND: "Room não encontrada (PATCH /freezer/:freezerId/room, storage.routes.js:523-526)",

  // 409 - Conflito
  STORAGE_COLLISION: "Posição já está ocupada (colisão detectada)",

  // ALREADY_ALLOCATED and BOX_FULL are sentinels specific to
  // POST /allocate/auto, returned by StorageService.autoAssignSampleToBox
  // (storageService.js:120-126 and :128-135 respectively) and mapped to 409
  // by auto-assign-sample.controller.js:41-45.
  ALREADY_ALLOCATED: "Amostra já está alocada em outra posição (POST /allocate/auto)",
  BOX_FULL: "Nenhuma posição disponível nesta box (POST /allocate/auto)",

  // ALLOCATION_ERROR, RELEASE_ERROR and MOVE_SAMPLE_ERROR are shared error
  // codes: their HTTP status varies by cause -- 409 (STORAGE_COLLISION),
  // 404 (não encontrada), 400 (validation-shaped message, matched against
  // an explicit allowlist) or 500 (any other/unexpected failure, the
  // default). See allocate-sample.controller.js, release-sample.controller.js
  // and move-sample.controller.js.
  ALLOCATION_ERROR: "Erro ao alocar amostra (409/404/400/500 conforme a causa)",
  RELEASE_ERROR: "Erro ao liberar posição (409/404/400/500 conforme a causa)",
  MOVE_SAMPLE_ERROR: "Erro ao mover amostra (409/404/400/500 conforme a causa)",

  // AUTO_ASSIGNMENT_ERROR and AUTO_ALLOCATION_ERROR are TWO DIFFERENT CODES
  // from two different layers of POST /allocate/auto -- NOT two spellings of
  // the same condition. They are not interchangeable, and this file does not
  // unify them (that would be an API change, out of scope here); it only
  // documents which layer each comes from and when a caller actually sees it.
  //
  // AUTO_ASSIGNMENT_ERROR -- storageService.js:273. The generic fallback
  // inside StorageService.autoAssignSampleToBox's own catch block, used when
  // the failure is none of BOX_NOT_FOUND/SAMPLE_NOT_FOUND/ALREADY_ALLOCATED/
  // BOX_FULL. This is the value a caller actually receives as `error` when
  // the service reports failure and auto-assign-sample.controller.js's
  // `!result.success` branch (:28-52) runs -- mapped to 500 there.
  //
  // AUTO_ALLOCATION_ERROR -- auto-assign-sample.controller.js, two sites,
  // only one reachable in production:
  //   :49 `result.error || 'AUTO_ALLOCATION_ERROR'` is UNREACHABLE: the real
  //       service always populates result.error on every failure path
  //       (including the AUTO_ASSIGNMENT_ERROR fallback above), so this
  //       default never fires against production code.
  //   :64 the catch around a THROWN (not returned) error -- e.g. the
  //       storageService call itself rejects before returning. This is the
  //       one callers actually see AUTO_ALLOCATION_ERROR from, mapped to 500.
  AUTO_ASSIGNMENT_ERROR: "Falha inesperada dentro do StorageService durante a alocação automática (500)",
  AUTO_ALLOCATION_ERROR: "Exceção lançada antes/fora do StorageService, capturada pelo controller (500) -- só o site :64 é alcançável",

  // 500 - Erro interno
  INTERNAL_ERROR: "Erro interno do servidor",
  QUERY_ERROR: "Erro ao buscar dados",
  STATS_ERROR: "Erro ao calcular estatísticas",
  INTEGRITY_CHECK_ERROR: "Erro ao verificar integridade",

  // 503 - Serviço indisponível
  // Emitido pelos quatro controllers de mutação de storage (allocate,
  // allocate/auto, move, release) quando req.app.locals.db está
  // ausente/falsy, verificado ANTES de qualquer outra validação de entrada.
  // Fontes: allocate-sample.controller.js:31-36,
  // auto-assign-sample.controller.js:8-14, move-sample.controller.js:34-40,
  // release-sample.controller.js:21-27.
  DATABASE_UNAVAILABLE: "Banco de dados não disponível"
};

module.exports = {
  ERROR_CODES
};
