import { describe, it, expect, vi, afterEach } from 'vitest';
const net = require('net');
const childProcess = require('child_process');
const { spawn } = childProcess;

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const portManager = require('../../src/utils/portManager');
const portManagerPath = require.resolve('../../src/utils/portManager');

/**
 * `exec` is destructured at module scope in portManager.js
 * (`const { exec } = require('child_process')`), so spying on
 * `child_process.exec` only takes effect for a *fresh* require of the
 * module obtained after the spy is installed - the destructuring has to
 * re-run against the mocked export (see cjs-mocking.md).
 */
function freshPortManagerWithMockedExec() {
  delete require.cache[portManagerPath];
  return require(portManagerPath);
}

/** Helper: occupy a port with a raw net server, returns the server (caller must close it) */
function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * Spawns a standalone child node process that listens on `port` until killed.
 * Using a *separate OS process* (rather than an in-process net.Server) lets us
 * safely exercise killProcessOnPort's real taskkill call without risking the
 * test runner's own process.
 */
function spawnPortHolder(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '-e',
      `require('net').createServer().listen(${port}, () => console.log('LISTENING'));`,
    ]);
    const timer = setTimeout(() => reject(new Error('timed out waiting for holder to listen')), 5000);
    child.stdout.on('data', (data) => {
      if (data.toString().includes('LISTENING')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('error', reject);
  });
}

async function getFreePort() {
  const probe = await occupyPort(0);
  const { port } = probe.address();
  await closeServer(probe);
  return port;
}

describe('portManager', () => {
  describe('isPortAvailable', () => {
    it('resolves true for a free port', async () => {
      const port = await getFreePort();
      const result = await portManager.isPortAvailable(port);
      expect(result).toBe(true);
    });

    it('resolves false when the port is already occupied', async () => {
      const port = await getFreePort();
      const probe = await occupyPort(port);

      const result = await portManager.isPortAvailable(port);
      expect(result).toBe(false);

      await closeServer(probe);
    });
  });

  describe('findAvailablePort', () => {
    it('returns the start port itself when it is free', async () => {
      const port = await getFreePort();
      const result = await portManager.findAvailablePort(port, 5);
      expect(result).toBe(port);
    });

    it('skips an occupied start port and returns a free one within range', async () => {
      const port = await getFreePort();
      const probe = await occupyPort(port);

      const result = await portManager.findAvailablePort(port, 5);

      expect(result).not.toBe(port);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(port);
      expect(result).toBeLessThan(port + 5);

      await closeServer(probe);
    });

    it('returns null when no port is free within maxAttempts', async () => {
      const port = await getFreePort();
      const probe = await occupyPort(port);

      // Only checking the single occupied port (maxAttempts=1) guarantees failure.
      const result = await portManager.findAvailablePort(port, 1);
      expect(result).toBeNull();

      await closeServer(probe);
    });
  });

  describe('getProcessUsingPort', () => {
    it('returns null when nothing is listening on the port', async () => {
      const port = await getFreePort();
      const result = await portManager.getProcessUsingPort(port);
      expect(result).toBeNull();
    });

    it('returns the pid (and usually process name) of the real process bound to the port', async () => {
      const port = await getFreePort();
      const holder = await spawnPortHolder(port);
      try {
        const result = await portManager.getProcessUsingPort(port);
        expect(result).not.toBeNull();
        expect(result.pid).toBe(String(holder.pid));
      } finally {
        holder.kill();
      }
    }, 15000);
  });

  describe('killProcessOnPort', () => {
    it('returns false when no process is using the port', async () => {
      const port = await getFreePort();
      const result = await portManager.killProcessOnPort(port);
      expect(result).toBe(false);
    });

    it('kills the real process bound to the port and frees it', async () => {
      const port = await getFreePort();
      const holder = await spawnPortHolder(port);

      // Sanity check: the port is genuinely occupied before we try to free it.
      expect(await portManager.isPortAvailable(port)).toBe(false);

      const result = await portManager.killProcessOnPort(port);
      expect(result).toBe(true);

      const nowAvailable = await portManager.isPortAvailable(port);
      expect(nowAvailable).toBe(true);
    }, 15000);
  });

  describe('getAvailablePort', () => {
    it('returns the requested port immediately when it is free', async () => {
      const port = await getFreePort();
      const result = await portManager.getAvailablePort(port);
      expect(result).toBe(port);
    });

    it('frees and reuses the requested port when the process on it can be killed', async () => {
      const port = await getFreePort();
      const holder = await spawnPortHolder(port);

      const result = await portManager.getAvailablePort(port);
      expect(result).toBe(port);

      // Holder should already be dead; killing again should be a no-op, not throw.
      holder.kill();
    }, 15000);

    // The next two tests exercise getAvailablePort's fallback/throw branches by
    // spying on the singleton's own methods rather than occupying real OS ports.
    // Reason: killProcessOnPort issues a real `taskkill`. Occupying a port with an
    // in-process net.Server would make netstat resolve back to *this test runner's
    // own pid*, and a real kill attempt would terminate the runner itself. Spying
    // keeps these branch tests deterministic and safe while the happy-path/kill
    // behavior above is still verified against the real OS.
    it('falls back to an alternative port when the occupying process cannot be freed', async () => {
      const isPortAvailableSpy = vi
        .spyOn(portManager, 'isPortAvailable')
        .mockResolvedValueOnce(false) // requested port initially busy
        .mockResolvedValueOnce(false); // still busy after the (failed) kill attempt
      const killSpy = vi.spyOn(portManager, 'killProcessOnPort').mockResolvedValueOnce(false);
      const findSpy = vi.spyOn(portManager, 'findAvailablePort').mockResolvedValueOnce(4321);

      const result = await portManager.getAvailablePort(1234);

      expect(result).toBe(4321);
      expect(killSpy).toHaveBeenCalledWith(1234);
      expect(findSpy).toHaveBeenCalledWith(1234);

      isPortAvailableSpy.mockRestore();
      killSpy.mockRestore();
      findSpy.mockRestore();
    });

    it('throws when the requested port and every fallback candidate are occupied', async () => {
      const isPortAvailableSpy = vi.spyOn(portManager, 'isPortAvailable').mockResolvedValue(false);
      const killSpy = vi.spyOn(portManager, 'killProcessOnPort').mockResolvedValue(false);
      const findSpy = vi.spyOn(portManager, 'findAvailablePort').mockResolvedValue(null);

      await expect(portManager.getAvailablePort(1234)).rejects.toThrow(
        'Não foi possível encontrar uma porta disponível próxima a 1234'
      );

      isPortAvailableSpy.mockRestore();
      killSpy.mockRestore();
      findSpy.mockRestore();
    });
  });

  describe('_getProcessUsingPortPosix (direct, exec mocked)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[portManagerPath];
    });

    it('returns pid and processName when lsof and ps both succeed', async () => {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        if (cmd.startsWith('lsof')) {
          cb(null, { stdout: '4242\n', stderr: '' });
        } else {
          cb(null, { stdout: 'node\n', stderr: '' });
        }
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm._getProcessUsingPortPosix(9999);

      expect(result).toEqual({ pid: '4242', processName: 'node' });
    });

    it('returns just the pid when ps fails to resolve the process name', async () => {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        if (cmd.startsWith('lsof')) {
          cb(null, { stdout: '4242\n', stderr: '' });
        } else {
          cb(new Error('ps failed'));
        }
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm._getProcessUsingPortPosix(9999);

      expect(result).toEqual({ pid: '4242' });
    });

    it('returns null when lsof itself fails (nothing listening)', async () => {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        cb(new Error('command not found'));
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm._getProcessUsingPortPosix(9999);

      expect(result).toBeNull();
    });

    it('getProcessUsingPort dispatches to the posix implementation on a non-win32 platform', async () => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
          if (cmd.startsWith('lsof')) cb(null, { stdout: '4242\n', stderr: '' });
          else cb(null, { stdout: 'node\n', stderr: '' });
        });

        const pm = freshPortManagerWithMockedExec();
        const result = await pm.getProcessUsingPort(9999);

        expect(result).toEqual({ pid: '4242', processName: 'node' });
      } finally {
        Object.defineProperty(process, 'platform', original);
      }
    });
  });

  describe('_getProcessUsingPortWindows (direct, exec mocked)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[portManagerPath];
    });

    it('returns just the pid when tasklist fails to resolve the process name', async () => {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        if (cmd.startsWith('netstat')) cb(null, { stdout: 'TCP 0.0.0.0:9999 LISTENING 4242\n', stderr: '' });
        else cb(new Error('tasklist failed'));
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm._getProcessUsingPortWindows(9999);

      expect(result).toEqual({ pid: '4242' });
    });
  });

  describe('killProcessOnPort on a non-win32 platform (process.kill path)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[portManagerPath];
    });

    function withPlatform(value, fn) {
      const original = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value, configurable: true });
      return fn().finally(() => {
        Object.defineProperty(process, 'platform', original);
      });
    }

    it('calls process.kill with SIGKILL and returns true on success', () =>
      withPlatform('linux', async () => {
        const pm = freshPortManagerWithMockedExec();
        vi.spyOn(pm, 'getProcessUsingPort').mockResolvedValue({ pid: '555', processName: 'node' });
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        const result = await pm.killProcessOnPort(9999);

        expect(result).toBe(true);
        expect(killSpy).toHaveBeenCalledWith(555, 'SIGKILL');
      }), 10000);

    it('returns false when process.kill throws', () =>
      withPlatform('linux', async () => {
        const pm = freshPortManagerWithMockedExec();
        vi.spyOn(pm, 'getProcessUsingPort').mockResolvedValue({ pid: '555', processName: 'node' });
        vi.spyOn(process, 'kill').mockImplementation(() => {
          throw new Error('ESRCH');
        });

        const result = await pm.killProcessOnPort(9999);

        expect(result).toBe(false);
      }));

    it('returns false when getProcessUsingPort itself throws', async () => {
      const pm = freshPortManagerWithMockedExec();
      vi.spyOn(pm, 'getProcessUsingPort').mockRejectedValue(new Error('unexpected failure'));

      const result = await pm.killProcessOnPort(9999);

      expect(result).toBe(false);
    });
  });
});
