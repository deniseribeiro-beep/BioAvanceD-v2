const {
  mappingRank,
  buildRecords,
} = require('../../../../src/reference-data/reference-imports/lab/convertOrphaPackToJsonl');
const { normalizeRecord } = require('../../../../src/reference-data/reference-imports/normalizeOrpha');

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
});
