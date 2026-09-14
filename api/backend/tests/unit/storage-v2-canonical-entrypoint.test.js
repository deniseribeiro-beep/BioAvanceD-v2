import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MongoStorageRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageRepository');

describe('Wave 2 storage canonical entrypoint', () => {
  it('exposes the normalized v2 repository as the canonical storage repository', () => {
    const source = MongoStorageRepository.toString();
    expect(source).toContain('class MongoStorageRepositoryV2');
    expect(source).toContain('findCurrentStorageAssignment');
  });
});
