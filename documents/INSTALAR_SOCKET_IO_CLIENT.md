# Instalar socket.io-client

## ⚠️ Problema

O `socket.io-client` está no `package.json` mas não está instalado no `node_modules`.

## ✅ Solução

Execute um dos comandos abaixo para instalar:

### Opção 1: PowerShell (se política permitir)

```powershell
npm install socket.io-client
```

### Opção 2: CMD (recomendado se PowerShell bloquear)

```cmd
cmd /c "npm install socket.io-client"
```

### Opção 3: Reinstalar todas as dependências

```bash
npm install
```

## ✅ Correções Aplicadas no Código

1. **Importação corrigida** - Agora usa `import` ES6 ao invés de `require`
2. **Vite config atualizado** - `socket.io-client` adicionado ao `optimizeDeps`
3. **Função createSocket** - Criada para gerenciar conexão socket

## 📋 Após Instalar

Após instalar, o erro do Vite deve desaparecer e o frontend funcionará normalmente.

---

**Status:** ⚠️ **AGUARDANDO INSTALAÇÃO: Execute `npm install` ou `npm install socket.io-client`**

