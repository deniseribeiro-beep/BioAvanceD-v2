import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const childProcess = require('child_process');

vi.mock('../../src/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const portManagerPath = require.resolve('../../src/utils/portManager');

function freshPortManager() {
  delete require.cache[portManagerPath];
  return require(portManagerPath);
}

async function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[portManagerPath];
});

describe('portManager.js item 8 residual platform branches', () => {
  it('returns pid and processName when Windows netstat/tasklist both succeed', async () => {
    vi.spyOn(childProcess, 'exec').mockImplementation((cmd, callback) => {
      if (cmd.startsWith('netstat')) {
        callback(null, {
          stdout: '  TCP    0.0.0.0:9999    0.0.0.0:0    LISTENING    4242\n',
          stderr: '',
        });
        return;
      }
      if (cmd.startsWith('tasklist')) {
        callback(null, {
          stdout: '"node.exe","4242","Console","1","12,000 K"\n',
          stderr: '',
        });
        return;
      }
      callback(new Error(`unexpected command: ${cmd}`));
    });

    const pm = freshPortManager();
    await expect(pm._getProcessUsingPortWindows(9999))
      .resolves.toEqual({ pid: '4242', processName: 'node.exe' });
  });

  it('dispatches getProcessUsingPort to the Windows implementation on win32', () =>
    withPlatform('win32', async () => {
      vi.spyOn(childProcess, 'exec').mockImplementation((cmd, callback) => {
        if (cmd.startsWith('netstat')) {
          callback(null, {
            stdout: 'TCP 0.0.0.0:9999 0.0.0.0:0 LISTENING 5151\n',
            stderr: '',
          });
        } else {
          callback(null, {
            stdout: '"worker.exe","5151","Console","1","8,000 K"\n',
            stderr: '',
          });
        }
      });

      const pm = freshPortManager();
      const result = await pm.getProcessUsingPort(9999);

      expect(result).toEqual({ pid: '5151', processName: 'worker.exe' });
    }));

  it('uses taskkill and succeeds on Windows without falling back to POSIX process.kill', () =>
    withPlatform('win32', async () => {
      const execSpy = vi.spyOn(childProcess, 'exec').mockImplementation((cmd, callback) => {
        if (cmd.startsWith('taskkill')) {
          callback(null, { stdout: 'SUCCESS', stderr: '' });
          return;
        }
        callback(new Error(`unexpected command: ${cmd}`));
      });
      const timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((callback) => {
        callback();
        return 0;
      });
      const killSpy = vi.spyOn(process, 'kill');
      const pm = freshPortManager();
      vi.spyOn(pm, 'getProcessUsingPort').mockResolvedValue({
        pid: '6161',
        processName: 'node.exe',
      });

      const result = await pm.killProcessOnPort(9999);

      expect(result).toBe(true);
      expect(execSpy.mock.calls.some(([cmd]) => cmd === 'taskkill /PID 6161 /F')).toBe(true);
      expect(killSpy).not.toHaveBeenCalled();
      expect(timeoutSpy).toHaveBeenCalled();
    }));

  it('returns the requested port after killing its occupant and confirming it became available', async () => {
    const pm = freshPortManager();
    const availability = vi.spyOn(pm, 'isPortAvailable')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.spyOn(pm, 'killProcessOnPort').mockResolvedValue(true);
    const findAlternative = vi.spyOn(pm, 'findAvailablePort');

    const result = await pm.getAvailablePort(4321);

    expect(result).toBe(4321);
    expect(availability).toHaveBeenCalledTimes(2);
    expect(findAlternative).not.toHaveBeenCalled();
  });
});
