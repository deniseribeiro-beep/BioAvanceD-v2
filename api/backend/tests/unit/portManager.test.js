import { describe, it, expect, vi, afterEach } from 'vitest';
const net = require('net');
const childProcess = require('child_process');
const { spawn } = childProcess;
const { promisify } = require('util');

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

/**
 * #1417: some Windows hosts (a sandboxed shell, Docker Desktop's networking)
 * leave a live listener out of `netstat -ano`, so the win32 lookup cannot find
 * it. Reads netstat on its own, apart from the code under test, and says
 * whether any TCP row names `port` as its local port. Outside win32 it answers
 * true, so the POSIX lookup runs as before.
 */
async function netstatListsPort(port) {
  if (process.platform !== 'win32') return true;
  const { stdout } = await promisify(childProcess.exec)('netstat -ano');
  return stdout.split('\n').some((line) => {
    const parts = line.trim().split(/\s+/);
    return parts[0] === 'TCP' && parts[1].endsWith(`:${port}`);
  });
}

const NETSTAT_BLIND = "netstat -ano does not list this test's own listener on this host (#1417)";

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
    afterEach(() => {
      vi.restoreAllMocks();
      delete require.cache[portManagerPath];
    });

    it('returns null when nothing is listening on the port', async () => {
      // findstr (and lsof) exit 1 with no hit; no real port is used, so another
      // process taking a just-released port cannot turn this red (#1390).
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        cb(Object.assign(new Error('Command failed'), { code: 1 }));
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm.getProcessUsingPort(5040);
      expect(result).toBeNull();
    });

    it('returns the pid (and usually process name) of the real process bound to the port', async (ctx) => {
      const port = await getFreePort();
      const holder = await spawnPortHolder(port);
      try {
        ctx.skip(!(await netstatListsPort(port)), NETSTAT_BLIND);
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

    it('kills the real process bound to the port and frees it', async (ctx) => {
      const port = await getFreePort();
      const holder = await spawnPortHolder(port);
      try {
        ctx.skip(!(await netstatListsPort(port)), NETSTAT_BLIND);

        // Sanity check: the port is genuinely occupied before we try to free it.
        expect(await portManager.isPortAvailable(port)).toBe(false);

        const result = await portManager.killProcessOnPort(port);
        expect(result).toBe(true);

        const nowAvailable = await portManager.isPortAvailable(port);
        expect(nowAvailable).toBe(true);
      } finally {
        // A no-op after a real kill; on a skip it frees the port.
        holder.kill();
      }
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
      // #1395: the lookup's two spawns measured up to 5954 ms (netstat) and
      // 3720 ms (tasklist) under ordinary load, and the two real-OS cases above
      // already prove it. This case proves the kill-then-reuse branch, so the
      // lookup answers with the holder's known pid; the real kill, the port's
      // release and both availability checks stay. What remains is the holder
      // spawn, the kill and the module's fixed 1000 ms sleep.
      const lookup = vi.spyOn(portManager, 'getProcessUsingPort').mockResolvedValue({ pid: String(holder.pid), processName: 'node' });

      try {
        const result = await portManager.getAvailablePort(port);
        expect(result).toBe(port);
        expect(lookup).toHaveBeenCalledWith(port);
      } finally {
        lookup.mockRestore();
        // Holder should already be dead; killing again should be a no-op, not throw.
        holder.kill();
      }
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
        if (cmd.startsWith('netstat')) cb(null, { stdout: 'TCP 0.0.0.0:9999 0.0.0.0:0 LISTENING 4242\n', stderr: '' });
        else cb(new Error('tasklist failed'));
      });

      const pm = freshPortManagerWithMockedExec();
      const result = await pm._getProcessUsingPortWindows(9999);

      expect(result).toEqual({ pid: '4242' });
    });

    // The mock answers every netstat filter with the same text, as findstr :<port>
    // would when the port is a substring of each line (#1390).
    function mockNetstat(netstatStdout) {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, cb) => {
        if (cmd.startsWith('netstat')) cb(null, { stdout: netstatStdout, stderr: '' });
        else cb(null, { stdout: '"svchost.exe","888","Services","0","1.234 K"\r\n', stderr: '' });
      });
      return freshPortManagerWithMockedExec();
    }

    it('returns null when only a longer port contains the requested port', async () => {
      const pm = mockNetstat('  TCP    0.0.0.0:50400          0.0.0.0:0              LISTENING       777\r\n');

      expect(await pm._getProcessUsingPortWindows(5040)).toBeNull();
    });

    it('skips a longer-port line listed first and returns the exact-port listener', async () => {
      const pm = mockNetstat(
        '  TCP    0.0.0.0:50400          0.0.0.0:0              LISTENING       777\r\n' +
          '  TCP    0.0.0.0:5040           0.0.0.0:0              LISTENING       888\r\n'
      );

      expect(await pm._getProcessUsingPortWindows(5040)).toEqual({ pid: '888', processName: 'svchost.exe' });
    });

    it('returns null when the port only appears in the foreign address column', async () => {
      const pm = mockNetstat('TCP 127.0.0.1:61000 127.0.0.1:5040 ESTABLISHED 999\n');

      expect(await pm._getProcessUsingPortWindows(5040)).toBeNull();
    });

    it('returns null for an outbound socket on the local port that is not listening', async () => {
      const pm = mockNetstat('TCP 10.0.0.2:5040 20.1.1.1:443 ESTABLISHED 19408\n');

      expect(await pm._getProcessUsingPortWindows(5040)).toBeNull();
    });

    it('returns the pid of an IPv6 listener on the exact port', async () => {
      const pm = mockNetstat('TCP [::]:5040 [::]:0 LISTENING 888\n');

      const result = await pm._getProcessUsingPortWindows(5040);

      expect(result.pid).toBe('888');
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
