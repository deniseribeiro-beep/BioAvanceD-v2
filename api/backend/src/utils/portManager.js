const net = require('net');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');

const execAsync = promisify(exec);

/**
 * Utilitário para gerenciar portas
 * Verifica disponibilidade e encontra portas alternativas
 */

class PortManager {
  /**
   * Verifica se uma porta está disponível
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => {
          resolve(true);
        });
        server.close();
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Encontra uma porta disponível próxima à porta desejada
   */
  async findAvailablePort(startPort, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
    }
    return null;
  }

  /**
   * Obtém o processo que está usando a porta (Windows e POSIX)
   */
  async getProcessUsingPort(port) {
    if (process.platform === 'win32') {
      return this._getProcessUsingPortWindows(port);
    }
    return this._getProcessUsingPortPosix(port);
  }

  async _getProcessUsingPortWindows(port) {
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n');
      if (lines.length > 0) {
        const parts = lines[0].trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid)) {
          try {
            const { stdout: taskStdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
            const taskParts = taskStdout.split(',');
            if (taskParts.length > 0) {
              const processName = taskParts[0].replace(/"/g, '');
              return { pid, processName };
            }
          } catch (e) {
            // Ignora erro ao obter nome do processo
          }
          return { pid };
        }
      }
    } catch (error) {
      // Porta não está em uso ou comando falhou
    }
    return null;
  }

  async _getProcessUsingPortPosix(port) {
    try {
      const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t`);
      const pid = stdout.trim().split('\n')[0].trim();
      if (pid && !isNaN(pid)) {
        try {
          const { stdout: commStdout } = await execAsync(`ps -p ${pid} -o comm=`);
          const processName = commStdout.trim();
          if (processName) {
            return { pid, processName };
          }
        } catch (e) {
          // Ignora erro ao obter nome do processo
        }
        return { pid };
      }
    } catch (error) {
      // Porta não está em uso ou comando falhou
    }
    return null;
  }

  /**
   * Tenta encerrar processo na porta (Windows e POSIX)
   */
  async killProcessOnPort(port) {
    try {
      const proc = await this.getProcessUsingPort(port);
      if (proc && proc.pid) {
        logger.warn(`Tentando encerrar processo ${proc.pid} (${proc.processName || 'desconhecido'}) na porta ${port}...`);
        try {
          if (process.platform === 'win32') {
            await execAsync(`taskkill /PID ${proc.pid} /F`);
          } else {
            process.kill(Number(proc.pid), 'SIGKILL');
          }
          logger.info(`✅ Processo ${proc.pid} encerrado com sucesso`);
          // Aguarda um pouco para a porta ser liberada
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        } catch (error) {
          logger.warn(`⚠️ Não foi possível encerrar processo ${proc.pid}: ${error.message}`);
          return false;
        }
      }
    } catch (error) {
      logger.warn(`⚠️ Erro ao tentar encerrar processo na porta ${port}: ${error.message}`);
    }
    return false;
  }

  /**
   * Obtém porta configurada ou encontra alternativa
   */
  async getAvailablePort(requestedPort) {
    const available = await this.isPortAvailable(requestedPort);
    
    if (available) {
      return requestedPort;
    }

    logger.warn(`⚠️ Porta ${requestedPort} está em uso. Tentando encontrar porta alternativa...`);
    
    // Tenta encerrar processo se possível
    const killed = await this.killProcessOnPort(requestedPort);
    if (killed) {
      const nowAvailable = await this.isPortAvailable(requestedPort);
      if (nowAvailable) {
        logger.info(`✅ Porta ${requestedPort} liberada com sucesso`);
        return requestedPort;
      }
    }

    // Encontra porta alternativa
    const alternativePort = await this.findAvailablePort(requestedPort);
    if (alternativePort) {
      logger.warn(`⚠️ Usando porta alternativa: ${alternativePort}`);
      return alternativePort;
    }

    throw new Error(`Não foi possível encontrar uma porta disponível próxima a ${requestedPort}`);
  }
}

module.exports = new PortManager();

