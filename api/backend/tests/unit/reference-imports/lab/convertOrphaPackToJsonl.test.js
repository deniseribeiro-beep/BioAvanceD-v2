const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  mappingRank,
  pickBestReference,
  buildRecords,
  convertOrphaPackFile,
  textOf,
  asArray,
} = require('../../../../src/reference-data/reference-imports/lab/convertOrphaPackToJsonl');
const { normalizeRecord } = require('../../../../src/reference-data/reference-imports/normalizeOrpha');

const PACK = 'Orphanet_Nomenclature_Pack_EN/';
const NOMENCLATURE = `${PACK}ORPHAnomenclature_en_2026.xml`;
const OMIM_MAP = `${PACK}ORPHA_OMIM_mapping_en_2026.xml`;
const ICD10_MAP = `${PACK}ORPHA_ICD10_mapping_en_2026.xml`;

// Minimal zip writer: stored entries (method 0) unless an entry names another
// method, so a test can build a pack without a zip library.
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 0 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(data, 'utf8');
    const crc = zlib.crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

function disorderList(inner) {
  return `<?xml version="1.0"?><JDBOR><DisorderList>${inner}</DisorderList></JDBOR>`;
}

describe('convertOrphaPackToJsonl', () => {
  it('ranks Exact mappings above NTBT', () => {
    expect(mappingRank('E (Exact mapping: the two concepts are equivalent)')).toBeLessThan(
      mappingRank('NTBT (ORPHAcode is narrower than the targeted code used to represent it)'),
    );
  });

  it('merges nomenclature + OMIM + ICD-10 into RF028 JSONL and intake relacoes (Fabry)', () => {
    const nomenclatureXml = `<?xml version="1.0"?><JDBOR><DisorderList>
      <Disorder>
        <OrphaCode>324</OrphaCode>
        <Name lang="en">Fabry disease</Name>
        <Totalstatus lang="en">Active</Totalstatus>
        <SynonymList><Synonym lang="en">FD</Synonym></SynonymList>
      </Disorder>
    </DisorderList></JDBOR>`;
    const omimXml = `<?xml version="1.0"?><JDBOR><DisorderList>
      <Disorder>
        <OrphaCode>324</OrphaCode>
        <ExternalReferenceList>
          <ExternalReference>
            <Source>OMIM</Source>
            <Reference>301500</Reference>
            <DisorderMappingRelation><Name lang="en">E (Exact mapping: the two concepts are equivalent)</Name></DisorderMappingRelation>
          </ExternalReference>
        </ExternalReferenceList>
      </Disorder>
    </DisorderList></JDBOR>`;
    const icd10Xml = `<?xml version="1.0"?><JDBOR><DisorderList>
      <Disorder>
        <OrphaCode>324</OrphaCode>
        <ExternalReferenceList>
          <ExternalReference>
            <Source>ICD-10</Source>
            <Reference>E75.2</Reference>
            <DisorderMappingRelation><Name lang="en">NTBT (ORPHAcode is narrower)</Name></DisorderMappingRelation>
          </ExternalReference>
        </ExternalReferenceList>
      </Disorder>
    </DisorderList></JDBOR>`;

    const { jsonl, intake } = buildRecords({ nomenclatureXml, omimXml, icd10Xml });
    expect(jsonl).toHaveLength(1);
    expect(jsonl[0]).toMatchObject({
      id: 'ORPHA:324',
      lbl: 'Fabry disease',
      synonyms: ['FD'],
      obsolete: false,
    });
    expect(normalizeRecord(jsonl[0], 1).ok).toBe(true);

    expect(intake[0].relacoes).toMatchObject({
      orpha: 'ORPHA:324',
      omim: 'OMIM:301500',
      cid: 'E75.2',
      cid10: 'E75.2',
    });
  });

  it('reads scalars, text nodes and lists from parsed XML', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray('x')).toEqual(['x']);
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(textOf(null)).toBe('');
    expect(textOf(' 42 ')).toBe('42');
    expect(textOf(42)).toBe('42');
    expect(textOf({ '#text': ' Fabry disease ', lang: 'en' })).toBe('Fabry disease');
    expect(textOf({ lang: 'en' })).toBe('');
    expect(textOf(true)).toBe('');
  });

  it('ranks Exact, BTNT, NTBT, ND, then anything else', () => {
    expect(mappingRank('E (Exact mapping)')).toBe(0);
    expect(mappingRank('Exact')).toBe(0);
    expect(mappingRank('BTNT (ORPHAcode is broader)')).toBe(1);
    expect(mappingRank('NTBT (ORPHAcode is narrower)')).toBe(2);
    expect(mappingRank('ND (not yet decided)')).toBe(3);
    expect(mappingRank('W (wrong)')).toBe(4);
    expect(mappingRank(undefined)).toBe(4);
  });

  describe('pickBestReference', () => {
    it('returns null when no reference comes from the source', () => {
      expect(pickBestReference([{ Source: 'MeSH', Reference: 'D000795' }, { Reference: '1' }], 'OMIM')).toBeNull();
    });

    it('prefers the best-ranked mapping over list order', () => {
      const refs = [
        { Source: 'OMIM', Reference: '300000', DisorderMappingRelation: { Name: { '#text': 'ND (not yet decided)' } } },
        { Source: 'omim', Reference: '301500', DisorderMappingRelation: { Name: { '#text': 'E (Exact mapping)' } } },
        { Source: 'OMIM', Reference: '200000', DisorderMappingRelation: { Name: { '#text': 'BTNT (broader)' } } },
      ];
      expect(pickBestReference(refs, 'OMIM')).toBe('301500');
    });

    it('breaks a rank tie by reference order', () => {
      const refs = [
        { Source: 'ICD-10', Reference: 'E75.2' },
        { Source: 'ICD-10' },
        { Source: 'ICD-10', Reference: 'E75.1' },
      ];
      expect(pickBestReference(refs, 'ICD-10')).toBeNull();
      expect(pickBestReference([refs[0], refs[2]], 'ICD-10')).toBe('E75.1');
    });

    it('returns null for a blank best reference', () => {
      expect(pickBestReference([{ Source: 'OMIM', Reference: '   ' }], 'OMIM')).toBeNull();
    });
  });

  it('skips disorders without a code or name, flags inactive ones and leaves unmapped relacoes empty', () => {
    const nomenclatureXml = disorderList(`
      <Disorder><OrphaCode>1</OrphaCode><Name lang="en">Active one</Name><Totalstatus lang="en">Active</Totalstatus></Disorder>
      <Disorder><OrphaCode>2</OrphaCode><Name lang="en">Gone one</Name><Totalstatus lang="en">Inactive: obsolete</Totalstatus></Disorder>
      <Disorder><OrphaCode>3</OrphaCode><Name lang="en">No status</Name></Disorder>
      <Disorder><Name lang="en">No code</Name></Disorder>
      <Disorder><OrphaCode>5</OrphaCode><Name lang="en"></Name></Disorder>
    `);
    const omimXml = disorderList(`
      <Disorder><ExternalReferenceList><ExternalReference><Source>OMIM</Source><Reference>100000</Reference></ExternalReference></ExternalReferenceList></Disorder>
      <Disorder><OrphaCode>1</OrphaCode><ExternalReferenceList>
        <ExternalReference><Reference>999</Reference></ExternalReference>
        <ExternalReference><Source>OMIM</Source><Reference>111111</Reference></ExternalReference>
      </ExternalReferenceList></Disorder>
      <Disorder><OrphaCode>2</OrphaCode><ExternalReferenceList><ExternalReference><Source>MeSH</Source><Reference>D1</Reference></ExternalReference></ExternalReferenceList></Disorder>
    `);
    const icd10Xml = '<?xml version="1.0"?><JDBOR></JDBOR>';

    const { jsonl, intake } = buildRecords({ nomenclatureXml, omimXml, icd10Xml });

    expect(jsonl.map((r) => r.id)).toEqual(['ORPHA:1', 'ORPHA:2', 'ORPHA:3']);
    expect(jsonl[0]).toEqual({ id: 'ORPHA:1', lbl: 'Active one', is_a: [], synonyms: [], obsolete: false });
    expect(jsonl[1].obsolete).toBe(true);
    expect(jsonl[2].obsolete).toBeFalsy();
    expect(intake.map((r) => r.ativo)).toEqual([true, false, true]);
    expect(intake[0]).toMatchObject({
      OMIM: 'OMIM:111111',
      Codigos_CID10: '',
      relacoes: { orpha: 'ORPHA:1', omim: 'OMIM:111111', cid: '', cid10: '', omimMapping: '', cid10Mapping: '' },
    });
    expect(intake[1].relacoes).toMatchObject({ omim: '', cid10: '', omimMapping: '', cid10Mapping: '' });
  });

  describe('convertOrphaPackFile', () => {
    let tmpRoot;

    const nomenclatureXml = disorderList(`
      <Disorder><OrphaCode>324</OrphaCode><Name lang="en">Fabry disease</Name><Totalstatus lang="en">Active</Totalstatus></Disorder>
      <Disorder><OrphaCode>558</OrphaCode><Name lang="en">Marfan syndrome</Name><Totalstatus lang="en">Active</Totalstatus></Disorder>
    `);
    const omimXml = disorderList(`
      <Disorder><OrphaCode>324</OrphaCode><ExternalReferenceList><ExternalReference><Source>OMIM</Source><Reference>301500</Reference><DisorderMappingRelation><Name lang="en">E (Exact mapping)</Name></DisorderMappingRelation></ExternalReference></ExternalReferenceList></Disorder>
    `);
    const icd10Xml = disorderList(`
      <Disorder><OrphaCode>324</OrphaCode><ExternalReferenceList><ExternalReference><Source>ICD-10</Source><Reference>E75.2</Reference></ExternalReference></ExternalReferenceList></Disorder>
      <Disorder><OrphaCode>558</OrphaCode><ExternalReferenceList><ExternalReference><Source>ICD-10</Source><Reference>Q87.4</Reference></ExternalReference></ExternalReferenceList></Disorder>
    `);

    function writePack(entries) {
      const zipPath = path.join(tmpRoot, 'pack.zip');
      fs.writeFileSync(zipPath, buildZip(entries));
      return zipPath;
    }

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orpha-convert-'));
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('reads the three pack entries and writes data.jsonl plus intake-records.jsonl beside it', async () => {
      const inputPath = writePack([
        { name: `${PACK}README.txt`, data: 'not read' },
        { name: NOMENCLATURE, data: nomenclatureXml },
        { name: OMIM_MAP, data: omimXml },
        { name: ICD10_MAP, data: icd10Xml },
      ]);
      const outputPath = path.join(tmpRoot, 'out', 'data.jsonl');

      const result = await convertOrphaPackFile({ inputPath, outputPath });

      const intakeOutputPath = path.join(tmpRoot, 'out', 'intake-records.jsonl');
      expect(result).toEqual({
        recordCount: 2,
        intakeRecordCount: 2,
        withOmim: 1,
        withCid10: 2,
        outputPath,
        intakeOutputPath,
      });
      expect(readJsonl(outputPath).map((r) => r.id)).toEqual(['ORPHA:324', 'ORPHA:558']);
      const intake = readJsonl(intakeOutputPath);
      expect(intake[0].relacoes).toMatchObject({ omim: 'OMIM:301500', cid10: 'E75.2', omimMapping: 'E (Exact mapping)' });
      expect(intake[1].relacoes).toMatchObject({ omim: '', cid10: 'Q87.4' });
    });

    it('writes the intake records to an explicit path', async () => {
      const inputPath = writePack([
        { name: NOMENCLATURE, data: nomenclatureXml },
        { name: OMIM_MAP, data: omimXml },
        { name: ICD10_MAP, data: icd10Xml },
      ]);
      const outputPath = path.join(tmpRoot, 'data.jsonl');
      const intakeOutputPath = path.join(tmpRoot, 'elsewhere', 'intake.jsonl');

      const result = await convertOrphaPackFile({ inputPath, outputPath, intakeOutputPath });

      expect(result.intakeOutputPath).toBe(intakeOutputPath);
      expect(readJsonl(intakeOutputPath)).toHaveLength(2);
      expect(fs.existsSync(path.join(tmpRoot, 'intake-records.jsonl'))).toBe(false);
    });

    it('refuses a pack missing one of the three entries', async () => {
      const inputPath = writePack([
        { name: NOMENCLATURE, data: nomenclatureXml },
        { name: OMIM_MAP, data: omimXml },
      ]);
      const outputPath = path.join(tmpRoot, 'data.jsonl');

      await expect(convertOrphaPackFile({ inputPath, outputPath })).rejects.toThrow(`Zip entry ausente: ${ICD10_MAP}`);
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    it('refuses a file that is not a zip', async () => {
      const inputPath = path.join(tmpRoot, 'pack.zip');
      fs.writeFileSync(inputPath, 'not a zip archive');

      await expect(convertOrphaPackFile({ inputPath, outputPath: path.join(tmpRoot, 'data.jsonl') }))
        .rejects.toThrow(/End of central directory record signature not found/);
    });

    it('refuses an entry stored with an unsupported compression method', async () => {
      const inputPath = writePack([
        { name: NOMENCLATURE, data: nomenclatureXml, method: 99 },
        { name: OMIM_MAP, data: omimXml },
        { name: ICD10_MAP, data: icd10Xml },
      ]);

      await expect(convertOrphaPackFile({ inputPath, outputPath: path.join(tmpRoot, 'data.jsonl') }))
        .rejects.toThrow('unsupported compression method: 99');
    });
  });
});
