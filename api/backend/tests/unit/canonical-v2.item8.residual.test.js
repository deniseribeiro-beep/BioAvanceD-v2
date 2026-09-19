import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';

const require = createRequire(import.meta.url);
const canonicalDictionary = require('../../src/reference-data/canonical-dictionary');
const canonicalContracts = require('../../src/contracts/canonical/v2');

const originalDictionaryPath = process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDictionaryPath === undefined) delete process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH;
  else process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH = originalDictionaryPath;
  canonicalDictionary.resetCacheForTests();
  canonicalContracts.resetCacheForTests();
});

describe('canonical v2 contract/dictionary item 8 residual branches', () => {
  it('uses the cached canonical dictionary path on repeated lookup', () => {
    canonicalDictionary.resetCacheForTests();
    const first = canonicalDictionary.resolveDictionaryPath();
    const second = canonicalDictionary.resolveDictionaryPath();
    expect(second).toBe(first);
  });

  it('fails closed when the approved canonical dictionary cannot be found', () => {
    canonicalDictionary.resetCacheForTests();
    delete process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH;
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => canonicalDictionary.resolveDictionaryPath()).toThrow('Canonical dictionary v2.0.0 not found');
  });

  it('parses Date, formula result, text and richText cell values from an exact approved-header worksheet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-dict-'));
    const file = path.join(dir, 'dict.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(canonicalDictionary.SOURCE_SHEET);
    sheet.addRow(canonicalDictionary.SOURCE_HEADERS);
    sheet.addRow([]);
    const row = sheet.addRow(Array(canonicalDictionary.SOURCE_HEADERS.length).fill(''));
    row.getCell(1).value = 'V2E-9998';
    row.getCell(2).value = new Date('2026-09-19T12:00:00.000Z');
    row.getCell(3).value = { formula: '"Specimen"', result: 'Specimen' };
    row.getCell(4).value = { text: 'customField', hyperlink: 'https://example.invalid' };
    row.getCell(5).value = { richText: [{ text: 'Display' }, { text: '' }] };
    await workbook.xlsx.writeFile(file);

    process.env.BIOAVANCED_CANONICAL_DICTIONARY_PATH = file;
    canonicalDictionary.resetCacheForTests();
    const loaded = await canonicalDictionary.loadCanonicalDictionary();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      elementId: 'V2E-9998',
      domain: '2026-09-19T12:00:00.000Z',
      entity: 'Specimen',
      canonicalField: 'customField',
      displayNamePt: 'Display',
    });
  });

  it('covers dictionary entity and persistence-authority selectors', async () => {
    const specimen = await canonicalDictionary.listByEntity('Specimen');
    const mongo = await canonicalDictionary.listByPersistenceAuthority('MongoDB');
    expect(Array.isArray(specimen)).toBe(true);
    expect(Array.isArray(mongo)).toBe(true);
  });

  it('treats a missing dataType as a non-array scalar contract', () => {
    expect(canonicalContracts.isArrayElement({ cardinality: '0..1' })).toBe(false);
  });

  it('fails contract registry construction when the canonical dictionary completeness gate fails', async () => {
    vi.spyOn(canonicalDictionary, 'loadCanonicalDictionary').mockResolvedValue([]);
    vi.spyOn(canonicalDictionary, 'checkCompleteness').mockResolvedValue({ verified: false });
    canonicalContracts.resetCacheForTests();

    await expect(canonicalContracts.getRegistry()).rejects.toThrow('completeness gate failed');
  });

  it('fails contract registry construction when required v2 workbook sheets are absent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bioavanced-contract-'));
    const file = path.join(dir, 'contracts.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('OTHER');
    await workbook.xlsx.writeFile(file);

    vi.spyOn(canonicalDictionary, 'loadCanonicalDictionary').mockResolvedValue([]);
    vi.spyOn(canonicalDictionary, 'checkCompleteness').mockResolvedValue({ verified: true });
    vi.spyOn(canonicalDictionary, 'resolveDictionaryPath').mockReturnValue(file);
    canonicalContracts.resetCacheForTests();

    await expect(canonicalContracts.getRegistry()).rejects.toThrow(
      'missing ENUMS, REGRAS_CONDICIONAIS or RELACIONAMENTOS'
    );
  });
});
