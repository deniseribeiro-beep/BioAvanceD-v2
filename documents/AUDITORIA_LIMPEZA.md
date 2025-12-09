# Auditoria e Limpeza do BioAdvanceD

## 🧹 Script de Limpeza Automática

Foi criado um script automatizado para limpar arquivos desnecessários, cache e dados temporários.

### Como Usar

```bash
# Na raiz do projeto
npm run cleanup

# Ou no backend
cd backend
npm run cleanup
```

## 📋 O Que É Limpo

### 1. Arquivos Temporários de Upload ✅
- **Localização:** `backend/uploads/temp/`
- **O que remove:** Arquivos temporários de upload (exceto `.gitkeep`)
- **Frequência:** Sempre que executar o script

### 2. Arquivos de Build ✅
- **Localização:** `dist/`, `dist-ssr/`, `build/`
- **O que remove:** Diretórios de build antigos
- **Frequência:** Sempre que executar o script

### 3. Arquivos de Log ✅
- **Localização:** Raiz do projeto e backend
- **O que remove:** `*.log`, `npm-debug.log*`, `yarn-debug.log*`, etc.
- **Frequência:** Sempre que executar o script

### 4. Arquivos do Sistema Operacional ✅
- **O que remove:** `.DS_Store`, `Thumbs.db`, `desktop.ini`
- **Frequência:** Sempre que executar o script

### 5. Cache do Vite ✅
- **Localização:** `.vite/`
- **O que remove:** Cache de build do Vite
- **Frequência:** Sempre que executar o script

### 6. Cache do npm ⚠️
- **O que faz:** Informa tamanho do cache (não remove automaticamente)
- **Ação manual:** `npm cache clean --force`

## 📊 Auditoria

O script também realiza auditoria de:

### 1. Tamanho do node_modules
- Mostra tamanho de cada `node_modules`
- Útil para identificar dependências grandes

### 2. Documentação
- Conta arquivos `.md`
- Identifica arquivos similares/duplicados

### 3. Arquivos .env
- Detecta arquivos `.env.local` (não remove por segurança)

## 🔒 Arquivos NÃO Removidos

Por segurança, os seguintes arquivos **NÃO** são removidos:

- ✅ `.env` e `.env.local` (contêm credenciais)
- ✅ `node_modules/` (dependências do projeto)
- ✅ Arquivos de código fonte
- ✅ `.gitkeep` em diretórios vazios
- ✅ Arquivos de configuração

## 📈 Exemplo de Saída

```
🧹 INICIANDO LIMPEZA E AUDITORIA DO BIOADVANCED
============================================================

📁 Limpando arquivos temporários de upload...
  ✅ Nenhum arquivo temporário encontrado

🏗️  Limpando arquivos de build...
  ✅ Nenhum diretório de build encontrado

📋 Limpando arquivos de log...
  ✅ Nenhum arquivo de log encontrado

🖥️  Limpando arquivos do sistema operacional...
  ✅ Nenhum arquivo do sistema encontrado

⚡ Limpando cache do Vite...
  ✅ Nenhum cache encontrado

📦 Auditando node_modules...
  📦 node_modules: 245.32 MB
  📦 backend/node_modules: 156.78 MB

📚 Auditando documentação...
  📄 Total de arquivos .md: 15
  ✅ Nenhum arquivo duplicado encontrado

============================================================
📊 RESUMO DA LIMPEZA
============================================================
✅ Arquivos removidos: 0
✅ Diretórios removidos: 0
✅ Espaço liberado: 0 B
============================================================
```

## 🛠️ Limpeza Manual Adicional

### Limpar Cache do npm

```bash
npm cache clean --force
```

### Limpar node_modules e Reinstalar

```bash
# Backend
cd backend
rm -rf node_modules package-lock.json
npm install

# Frontend
rm -rf node_modules package-lock.json
npm install
```

### Limpar Cache do Redis (se necessário)

```bash
redis-cli FLUSHALL
```

### Limpar Banco de Dados (CUIDADO!)

```bash
# Apenas em desenvolvimento
# MongoDB
mongo bioavanced --eval "db.dropDatabase()"
```

## 📝 Checklist de Limpeza Regular

Execute o script de limpeza:

- [ ] **Diariamente:** Arquivos temporários de upload
- [ ] **Semanalmente:** Logs e cache do Vite
- [ ] **Mensalmente:** Arquivos de build antigos
- [ ] **Conforme necessário:** Cache do npm

## 🔍 Verificação de Espaço

Para verificar espaço usado:

```bash
# Windows
dir /s

# Linux/Mac
du -sh *
```

## ⚠️ Avisos

1. **Não execute em produção** sem backup
2. **Arquivos .env** nunca são removidos automaticamente
3. **node_modules** não é removido (requer reinstalação manual)
4. **Backup do banco** antes de limpar dados

## 📚 Arquivos Relacionados

- `scripts/cleanup.js` - Script de limpeza
- `.gitignore` - Arquivos ignorados pelo Git
- `AUDITORIA_LIMPEZA.md` - Este documento

---

**Última atualização:** 2024-12-19

