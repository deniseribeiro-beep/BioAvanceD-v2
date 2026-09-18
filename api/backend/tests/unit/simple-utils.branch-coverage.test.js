import { describe, expect, it } from 'vitest';

const {
  normalizeBarcodeText,
  stripScannerPrefix,
  parseScannedBarcode,
  generateBarcodeSymbologies,
  generateIndustrialBarcodeArtifacts,
} = require('../../src/utils/barcodeSymbology');
const ClinicalUnitModel = require('../../src/models/ClinicalUnit');
const {
  TYPE_TAGS,
  canonicalize,
  digestCanonical,
  isPlainObject,
} = require('../../src/services/audit-canonicalization.service');

describe('simple utility/model branch coverage for item 8', () => {
  it('covers canonical JSON scalar, collection, numeric and rejection branches', () => {
    expect(TYPE_TAGS).toEqual(expect.objectContaining({
      null: 'null',
      boolean: 'bool',
      number: 'num',
      string: 'str',
      array: 'arr',
      object: 'obj',
    }));

    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);

    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('abc')).toBe('"abc"');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(-0)).toBe('0');
    expect(canonicalize(1.5)).toBe('1.5');
    expect(canonicalize([3, 'x', false, null])).toBe('[3,"x",false,null]');
    expect(canonicalize({ b: 2, a: { z: true, y: [1, null] } }))
      .toBe('{"a":{"y":[1,null],"z":true},"b":2}');

    expect(() => canonicalize(Number.NaN)).toThrow('NaN e Infinity');
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow('NaN e Infinity');
    expect(() => canonicalize(undefined)).toThrow('Tipo não suportado');
    expect(() => canonicalize(() => {})).toThrow('Tipo não suportado');
    expect(() => canonicalize(new Date())).toThrow('Tipo não suportado');
  });

  it('covers canonical digest default and explicit algorithms', () => {
    const sha256 = digestCanonical({ b: 2, a: 1 });
    const sha1 = digestCanonical({ a: 1, b: 2 }, 'sha1');

    expect(sha256.canonical).toBe('{"a":1,"b":2}');
    expect(sha256.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(sha1.canonical).toBe(sha256.canonical);
    expect(sha1.hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('covers ClinicalUnit empty/default/stop-word and validation branches', () => {
    expect(ClinicalUnitModel.normalizeName(null)).toBe('');
    expect(ClinicalUnitModel.normalizeName('  Clínica   São José  ')).toBe('CLINICA SAO JOSE');
    expect(ClinicalUnitModel.fillAcronym('')).toBeNull();
    expect(ClinicalUnitModel.fillAcronym('de da e')).toBe('DDE');
    expect(ClinicalUnitModel.fillAcronym('Unidade de Terapia Intensiva')).toBe('UTI');

    expect(ClinicalUnitModel.validate()).toEqual({
      isValid: false,
      errors: ['name é obrigatório'],
    });
    expect(ClinicalUnitModel.validate({ name: 'UT' }).errors).toContain('name deve ter ao menos 3 caracteres');
    expect(ClinicalUnitModel.validate({ name: 'Unidade', active: 'yes' }).errors).toContain('active deve ser boolean');
    expect(ClinicalUnitModel.validate({ name: 'Unidade', active: false })).toEqual({
      isValid: true,
      errors: [],
    });

    const withDefaults = ClinicalUnitModel.create({ name: '  Unidade   Central  ' });
    expect(withDefaults).toEqual(expect.objectContaining({
      name: 'Unidade Central',
      normalizedName: 'UNIDADE CENTRAL',
      acronym: 'UC',
      active: true,
    }));

    const explicitlyInactive = ClinicalUnitModel.create({ name: 'Unidade Sul', active: false });
    expect(explicitlyInactive.active).toBe(false);
  });

  it('covers barcode coercion and industrial artifact default/override branches', async () => {
    expect(normalizeBarcodeText(false)).toBe('');
    expect(stripScannerPrefix(0)).toBe('');
    expect(parseScannedBarcode(0)).toEqual(expect.objectContaining({
      rawValue: '',
      scannerSymbology: 'UNKNOWN',
      normalizedValue: '',
      isValid: false,
    }));

    expect(() => generateBarcodeSymbologies(false)).toThrow('obrigatório');
    await expect(generateIndustrialBarcodeArtifacts('   ')).rejects.toThrow('obrigatório');

    const defaults = await generateIndustrialBarcodeArtifacts(' BIO-001 ');
    expect(defaults.canonicalValue).toBe('BIO-001');
    expect(defaults.code128.imagePng).toEqual(expect.objectContaining({
      mimeType: 'image/png',
      base64: expect.any(String),
    }));
    expect(defaults.code128.imagePng.renderOptions).toEqual(expect.objectContaining({
      bcid: 'code128',
      height: 12,
      includetext: true,
      textxalign: 'center',
    }));
    expect(defaults.dataMatrix.imagePng.renderOptions).toEqual(expect.objectContaining({
      bcid: 'datamatrix',
      height: null,
      includetext: false,
      textxalign: null,
    }));
    expect(defaults.qr.imagePng.renderOptions.bcid).toBe('qrcode');

    const noPayload = await generateIndustrialBarcodeArtifacts('BIO-002', {
      includePayload: false,
      code128: { scale: 2, height: 10, paddingwidth: 0, paddingheight: 0 },
      dataMatrix: { scale: 3 },
      qr: { scale: 4 },
    });
    expect(noPayload.code128.imagePng.base64).toBeNull();
    expect(noPayload.dataMatrix.imagePng.base64).toBeNull();
    expect(noPayload.qr.imagePng.base64).toBeNull();
    expect(noPayload.code128.imagePng.renderOptions).toEqual(expect.objectContaining({
      scale: 2,
      height: 10,
      paddingwidth: 0,
      paddingheight: 0,
    }));
    expect(noPayload.dataMatrix.imagePng.renderOptions.scale).toBe(3);
    expect(noPayload.qr.imagePng.renderOptions.scale).toBe(4);
  });
});
