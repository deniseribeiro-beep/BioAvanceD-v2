const {
  convertMarkerDbTsvLines,
  convertMarkerDbXml,
  extractOrpha,
  extractPmid,
  MARKERDB_CONDITION_URI,
} = require('../../src/reference-data/reference-imports/lab/convertMarkerDbToJsonl');

describe('convertMarkerDbToJsonl', () => {
  it('extracts ORPHA and PMID', () => {
    expect(extractOrpha('Fabry disease ORPHA:324')).toBe('ORPHA:324');
    expect(extractPmid('See PMID:19815438 for details')).toBe('19815438');
    expect(extractPmid('27899403; 22055160')).toBe('27899403');
  });

  it('converts TSV rows with ORPHA+PMID and skips incomplete rows', () => {
    const lines = [
      'name\tgene\tcondition\treference',
      'Alpha-galactosidase\tGLA\tFabry ORPHA:324\tPMID:19815438',
      'Incomplete\tX\tNo orpha here\t',
      'NoEvidence\tY\tORPHA:365\tno pmid',
    ];
    const rows = convertMarkerDbTsvLines(lines, { sourceDataset: 'proteins' });
    expect(rows).toHaveLength(1);
    expect(rows[0].analyte.display).toBe('GLA');
    expect(rows[0].associatedCondition[0].code).toBe('ORPHA:324');
    expect(rows[0].evidenceReferences[0]).toEqual({ system: 'PMID', value: '19815438' });
    expect(rows[0].sourceId).toBe('SRC_MARKERDB');
  });

  it('maps free-text conditions to provisional MarkerDB URI when PMID present', () => {
    const lines = [
      'name\tgene_name\tuniprot_id\tconditions\tindication_types\tcitation',
      'Glycated hemoglobin\tHBA1\tP69905\tDiabetes Mellitus Type 2\tDiagnostic\tPMID:21234567',
    ];
    const rows = convertMarkerDbTsvLines(lines, { sourceDataset: 'download_all_proteins' });
    expect(rows).toHaveLength(1);
    expect(rows[0].associatedCondition[0].systemUri).toBe(MARKERDB_CONDITION_URI);
    expect(rows[0].biomarkerRole).toBe('diagnostic');
    expect(rows[0].analyte.systemUri).toContain('uniprot');
  });

  it('parses protein XML condition blocks', () => {
    const xml = `<?xml version="1.0"?>
<proteins><protein>
  <name>GLA</name><gene_name>GLA</gene_name><uniprot_id>P06280</uniprot_id>
  <conditions>
    <condition>
      <condition>Fabry disease ORPHA:324</condition>
      <indication_type>Diagnostic</indication_type>
      <citation>PMID:19815438</citation>
      <biofluid>Plasma</biofluid>
    </condition>
  </conditions>
</protein></proteins>`;
    const rows = convertMarkerDbXml(xml, 'download_all_proteins');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].associatedCondition[0].code).toBe('ORPHA:324');
    expect(rows[0].evidenceReferences[0].value).toBe('19815438');
  });
});
