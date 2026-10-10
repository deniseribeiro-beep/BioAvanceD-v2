import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const LabelIdentifierModel = require('../../../src/models/LabelIdentifier');

// #1314 (RF016 AC4/AC5, RULE-012, RULE-034).
const manufacturer = {
  encodedValue: 'BVA2:synthetic:8K3M',
  symbology: 'data_matrix',
  targetType: 'container',
  targetId: 'CT-1',
  identifierOrigin: 'manufacturer_applied',
  namespaceRegistryId: 'ns-tube-vendor',
  carrierPlacement: 'container_bottom',
  immutableAtSource: true,
};
const institutional = {
  ...manufacturer,
  symbology: 'code_128',
  targetType: 'storage_rack',
  targetId: 'rack-96-001',
  identifierOrigin: 'institution_applied',
  namespaceRegistryId: 'ns-biobank',
  carrierPlacement: 'rack_side',
  immutableAtSource: false,
  issuedAt: '2026-10-09T12:00:00.000Z',
  issuedBy: 'user-1',
  templateVersionId: 'tpl-rack-v1',
  printBatchId: 'batch-0001',
};

describe('LabelIdentifier model (RF016 AC4/AC5)', () => {
  it('accepts a manufacturer Data Matrix on a container with no issuance, template or batch (RULE-034)', () => {
    const label = LabelIdentifierModel.create(manufacturer);
    expect(label).toMatchObject({ status: 'active', identifierOrigin: 'manufacturer_applied', immutableAtSource: true, issuedBy: null });
    expect(label.labelIdentifierId).toBeTruthy();
  });

  it('refuses a manufacturer identifier whose target is not a container (RULE-034)', () => {
    expect(() => LabelIdentifierModel.create({ ...manufacturer, targetType: 'storage_rack' })).toThrow(/RULE-034/);
  });

  it('requires issuance, template and batch of an institutional identifier (RF016 AC4)', () => {
    expect(LabelIdentifierModel.create(institutional)).toMatchObject({ printBatchId: 'batch-0001', templateVersionId: 'tpl-rack-v1' });
    const { printBatchId, templateVersionId, ...withoutBoth } = institutional;
    expect(() => LabelIdentifierModel.create(withoutBoth)).toThrow('Identificador institucional exige templateVersionId, printBatchId (RF016 AC4)');
  });

  it('records origin, placement and source immutability, each required (RF016 AC4)', () => {
    expect(() => LabelIdentifierModel.create({ ...manufacturer, carrierPlacement: null })).toThrow(/carrierPlacement/);
    expect(() => LabelIdentifierModel.create({ ...manufacturer, identifierOrigin: null })).toThrow(/identifierOrigin/);
    expect(() => LabelIdentifierModel.create({ ...manufacturer, immutableAtSource: undefined })).toThrow(/immutableAtSource/);
    expect(() => LabelIdentifierModel.create({ ...manufacturer, identifierOrigin: 'handwritten' })).toThrow('identifierOrigin inválido: handwritten');
  });

  it('accepts the three symbologies RF016 AC5 names and no other', () => {
    for (const symbology of ['data_matrix', 'code_128', 'qr_code']) {
      expect(LabelIdentifierModel.create({ ...manufacturer, symbology }).symbology).toBe(symbology);
    }
    expect(() => LabelIdentifierModel.create({ ...manufacturer, symbology: 'ean_13' })).toThrow('symbology inválido: ean_13');
  });

  it('refuses an encoded value carrying a CPF, an e-mail or free text (RULE-012)', () => {
    for (const encodedValue of ['BVA2:123.456.789-09', 'BVA2:12345678909', 'maria@example.org', 'Maria Silva']) {
      expect(() => LabelIdentifierModel.create({ ...manufacturer, encodedValue })).toThrow(/RULE-012/);
    }
  });

  it('accepts a digit run that is not a CPF: inside a longer number, or 11 digits whose check digits fail (#1359)', () => {
    for (const encodedValue of ['BVA2:synthetic:1760108400000-ab12', 'TUBE-12345678900', 'BVA2:1234567890912']) {
      expect(LabelIdentifierModel.create({ ...manufacturer, encodedValue }).encodedValue).toBe(encodedValue);
    }
  });
});
