#!/bin/bash
# ============================================================================
# STORAGE SYSTEM - SETUP SCRIPT (SEMANA 2)
# ============================================================================
# Script para preparar e testar o sistema de armazenagem física
# Data: Feb 12, 2026
# ============================================================================

set -e  # Exit on error

echo "================================"
echo "🚀 Storage System - Setup"
echo "================================"
echo ""

# ============================================================================
# 1. CRIAR COLEÇÕES E ÍNDICES
# ============================================================================
echo "📦 [1/5] Criando coleções e índices..."
node backend/scripts/create-db.js
if [ $? -eq 0 ]; then
  echo "✅ Coleções criadas com sucesso"
else
  echo "❌ Erro ao criar coleções"
  exit 1
fi

echo ""

# ============================================================================
# 2. MIGRAR STORAGE LOCATION EM AMOSTRAS
# ============================================================================
echo "🔄 [2/5] Migrando campo storageLocation em amostras..."
node backend/scripts/migrate-storage-location.js
if [ $? -eq 0 ]; then
  echo "✅ Migração concluída"
else
  echo "❌ Erro ao migrar"
  exit 1
fi

echo ""

# ============================================================================
# 3. VERIFICAR MODELOS
# ============================================================================
echo "📋 [3/5] Verificando modelos..."

# Verificar se os arquivos existem
files=(
  "backend/src/models/StorageContainer.js"
  "backend/src/models/StorageBox.js"
  "backend/src/models/StoragePath.js"
  "backend/src/services/storageService.js"
  "backend/src/controllers/storage.controller.js"
  "backend/src/routes/storage.routes.js"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "   ✅ $file"
  else
    echo "   ❌ $file - NÃO ENCONTRADO"
    exit 1
  fi
done

echo ""

# ============================================================================
# 4. VERIFICAR ROTAS NO SERVER
# ============================================================================
echo "🔌 [4/5] Verificando integração de rotas..."

if grep -q 'app.use("/api/storage"' backend/server.js; then
  echo "   ✅ Rotas de storage registradas no server.js"
else
  echo "   ❌ Rotas de storage NÃO encontradas no server.js"
  exit 1
fi

echo ""

# ============================================================================
# 5. RESUMO FINAL
# ============================================================================
echo "📊 [5/5] Setup Completo!"
echo ""
echo "================================"
echo "✅ STORAGE SYSTEM ATIVADO"
echo "================================"
echo ""
echo "📚 Arquivos criados:"
echo "   └── Models (3):"
echo "       ├── StorageContainer.js"
echo "       ├── StorageBox.js"
echo "       └── StoragePath.js"
echo ""
echo "   └── Service (1):"
echo "       └── storageService.js"
echo ""
echo "   └── Controller (1):"
echo "       └── storage.controller.js"
echo ""
echo "   └── Routes (1):"
echo "       └── storage.routes.js"
echo ""
echo "   └── Scripts (2):"
echo "       ├── create-db.js (modificado)"
echo "       └── migrate-storage-location.js"
echo ""
echo "   └── Documentation (2):"
echo "       ├── STORAGE_SYSTEM.md"
echo "       └── STORAGE_API_EXAMPLES.js"
echo ""
echo "🔌 Endpoints disponíveis:"
echo "   ├── POST   /api/storage/allocate"
echo "   ├── DELETE /api/storage/release/:sampleId"
echo "   ├── GET    /api/storage/sample/:sampleId"
echo "   ├── GET    /api/storage/box/:boxId/available"
echo "   ├── GET    /api/storage/validate/:boxId/:position"
echo "   ├── GET    /api/storage/freezer/:freezerId/tree"
echo "   ├── GET    /api/storage/freezer/:freezerId/stats"
echo "   └── GET    /api/storage/box/:boxId/integrity"
echo ""
echo "🧪 Para testar:"
echo "   npm start"
echo "   # Em outro terminal:"
echo "   curl -H \"Authorization: Bearer TOKEN\" http://localhost:3000/api/storage/freezer/ID/tree"
echo ""
echo "📖 Documentação:"
echo "   └── documents/STORAGE_SYSTEM.md"
echo "   └── docs/STORAGE_API_EXAMPLES.js"
echo ""
