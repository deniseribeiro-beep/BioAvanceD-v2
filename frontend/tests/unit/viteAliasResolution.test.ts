import { describe, expect, it } from 'vitest';
import { apiClient } from '@/api/client';

describe('vitest @ path alias', () => {
  it('resolves @/ imports the same way vite.config.js does (issue #520)', () => {
    expect(apiClient).toBeTruthy();
  });
});
