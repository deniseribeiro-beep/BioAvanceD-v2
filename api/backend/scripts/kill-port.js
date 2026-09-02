#!/usr/bin/env node

/**
 * Script para encerrar o processo que está ocupando uma porta
 * Uso: node scripts/kill-port.js <porta>
 */

const portManager = require('../src/utils/portManager');

async function main() {
  const arg = process.argv[2];
  const port = Number(arg);

  if (arg === undefined || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`❌ Porta inválida: ${arg === undefined ? '(nenhuma informada)' : arg}`);
    console.error('   Uso: npm run kill-port <porta>');
    process.exitCode = 1;
    return;
  }

  const available = await portManager.isPortAvailable(port);
  if (available) {
    console.log(`🟢 Porta ${port}: ✅ Disponível - nenhum processo para encerrar`);
    return;
  }

  const proc = await portManager.getProcessUsingPort(port);
  if (proc) {
    console.log(`🔴 Porta ${port}: ❌ Em uso - PID: ${proc.pid}${proc.processName ? ` (${proc.processName})` : ''}`);
  }

  const killed = await portManager.killProcessOnPort(port);

  if (!killed) {
    console.log(`⚠️ Não foi possível encerrar o processo na porta ${port}`);
    process.exitCode = 1;
    return;
  }

  const nowAvailable = await portManager.isPortAvailable(port);
  if (nowAvailable) {
    console.log(`✅ Porta ${port} liberada com sucesso`);
  } else {
    console.log(`⚠️ Processo encerrado, mas a porta ${port} continua em uso`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
