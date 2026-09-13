import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const CONNECTION_MODULE_PATH = require.resolve(
  '../../src/infrastructure/database/mongodb/connection'
);

// CJS require cache guarantees this is the same module object the source
// file's own require('mongoose') / require('../../../config/env') /
// require('../../../utils/logger') resolve to.
const mongoose = require('mongoose');
const env = require('../../config/env');
const logger = require('../../src/utils/logger');

function freshConnectionModule() {
  delete require.cache[CONNECTION_MODULE_PATH];
  // eslint-disable-next-line global-require
  return require('../../src/infrastructure/database/mongodb/connection');
}

describe('infrastructure/database/mongodb/connection.js', () => {
  const originalMongoUri = env.MONGO_URI;
  const originalMongoDb = env.MONGO_DB;
  const originalReadyState = mongoose.connection.readyState;

  beforeEach(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[CONNECTION_MODULE_PATH];
    env.MONGO_URI = originalMongoUri;
    env.MONGO_DB = originalMongoDb;
    mongoose.connection.readyState = originalReadyState;
  });

  describe('connectMongoDB', () => {
    it('returns the existing connection immediately without calling mongoose.connect when readyState is 1 (connected)', async () => {
      mongoose.connection.readyState = 1;
      const connectSpy = vi.spyOn(mongoose, 'connect');
      const connection = freshConnectionModule();

      const result = await connection.connectMongoDB();

      expect(result).toBe(mongoose.connection);
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('throws when MONGO_URI is not configured and does not call mongoose.connect', async () => {
      mongoose.connection.readyState = 0;
      env.MONGO_URI = undefined;
      const connectSpy = vi.spyOn(mongoose, 'connect');
      const connection = freshConnectionModule();

      await expect(connection.connectMongoDB()).rejects.toThrow(
        /MONGO_URI não configurada/
      );
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('memoizes connectionPromise: concurrent calls invoke mongoose.connect only once', async () => {
      mongoose.connection.readyState = 0;
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = 'testdb';

      let resolveConnect;
      const pendingConnect = new Promise((resolve) => {
        resolveConnect = resolve;
      });
      const connectSpy = vi
        .spyOn(mongoose, 'connect')
        .mockImplementation(() => pendingConnect);

      const connection = freshConnectionModule();

      const call1 = connection.connectMongoDB();
      const call2 = connection.connectMongoDB();

      expect(connectSpy).toHaveBeenCalledTimes(1);

      resolveConnect({ connection: mongoose.connection });
      const [result1, result2] = await Promise.all([call1, call2]);

      expect(result1).toBe(mongoose.connection);
      expect(result2).toBe(mongoose.connection);
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('clears connectionPromise and rethrows on a connect failure, allowing a subsequent call to retry', async () => {
      mongoose.connection.readyState = 0;
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = 'testdb';

      const connectSpy = vi
        .spyOn(mongoose, 'connect')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ connection: mongoose.connection });

      const connection = freshConnectionModule();

      await expect(connection.connectMongoDB()).rejects.toThrow('ECONNREFUSED');
      expect(connectSpy).toHaveBeenCalledTimes(1);

      // Retry: since connectionPromise was cleared to null, this must call
      // mongoose.connect a second time rather than reusing the failed promise.
      const result = await connection.connectMongoDB();
      expect(result).toBe(mongoose.connection);
      expect(connectSpy).toHaveBeenCalledTimes(2);
    });

    it('passes the expected connection options to mongoose.connect', async () => {
      mongoose.connection.readyState = 0;
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = 'testdb';

      const connectSpy = vi
        .spyOn(mongoose, 'connect')
        .mockResolvedValue({ connection: mongoose.connection });

      const connection = freshConnectionModule();
      await connection.connectMongoDB();

      expect(connectSpy).toHaveBeenCalledWith(
        'mongodb://localhost:27017',
        expect.objectContaining({
          dbName: 'testdb',
          maxPoolSize: 20,
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 45000,
          autoIndex: false
        })
      );
    });
  });

  describe('getMongoDBConnection', () => {
    it('returns mongoose.connection when readyState is 1 (connected)', () => {
      mongoose.connection.readyState = 1;
      const connection = freshConnectionModule();

      expect(connection.getMongoDBConnection()).toBe(mongoose.connection);
    });

    it('throws when readyState is not 1', () => {
      mongoose.connection.readyState = 0;
      const connection = freshConnectionModule();

      expect(() => connection.getMongoDBConnection()).toThrow(
        /Conexão indisponível para operação crítica/
      );
    });
  });

  describe('closeMongoDBConnection', () => {
    it('is a no-op when readyState is 0 (disconnected) and does not call connection.close()', async () => {
      mongoose.connection.readyState = 0;
      const closeSpy = vi.spyOn(mongoose.connection, 'close');
      const connection = freshConnectionModule();

      await connection.closeMongoDBConnection();

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('calls mongoose.connection.close() and clears connectionPromise when connected', async () => {
      mongoose.connection.readyState = 1;
      const closeSpy = vi
        .spyOn(mongoose.connection, 'close')
        .mockResolvedValue(undefined);
      const connection = freshConnectionModule();

      await connection.closeMongoDBConnection();

      expect(closeSpy).toHaveBeenCalledTimes(1);

      // connectionPromise having been cleared means a subsequent connect
      // attempt calls mongoose.connect again rather than reusing a stale
      // promise from before the close.
      mongoose.connection.readyState = 0;
      env.MONGO_URI = 'mongodb://localhost:27017';
      env.MONGO_DB = 'testdb';
      const connectSpy = vi
        .spyOn(mongoose, 'connect')
        .mockResolvedValue({ connection: mongoose.connection });

      await connection.connectMongoDB();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });
  });
});
