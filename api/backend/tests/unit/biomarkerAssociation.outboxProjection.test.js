/**
 * Contract: BIOMARKER_ASSOCIATION_UPSERTED is recognized by the projector
 * and GraphProjectionService exposes appendBiomarkerAssociationEvent.
 */
const { Neo4jCanonicalProjectionService } = require('../../src/services/neo4jCanonicalProjection.service');
const { GraphProjectionService } = require('../../src/services/graphProjection.service');

describe('BiomarkerAssociation outbox projection', () => {
  it('appendBiomarkerAssociationEvent writes the approved event shape', async () => {
    const appended = [];
    const graph = new GraphProjectionService({
      outbox: {
        appendEvent: async (_db, event) => {
          appended.push(event);
          return { eventId: 'e1' };
        },
      },
    });
    await graph.appendBiomarkerAssociationEvent({}, {
      biomarkerId: 'ba-1',
      orphaCode: '324',
      analyte: { systemUri: 'https://www.genenames.org', code: 'HGNC:4296', display: 'GLA' },
      biomarkerRole: 'diagnostic',
      contextOfUse: 'Fabry',
    });
    expect(appended).toHaveLength(1);
    expect(appended[0].eventType).toBe('BIOMARKER_ASSOCIATION_UPSERTED');
    expect(appended[0].aggregateType).toBe('BiomarkerAssociation');
    expect(appended[0].payload.orphaCode).toBe('324');
    expect(appended[0].payload.analyte.code).toBe('HGNC:4296');
  });

  it('applyEvent projects POSSUI_BIOMARCADOR via Cypher MERGE', async () => {
    const runs = [];
    const session = {
      run: async (cypher, params) => {
        runs.push({ cypher, params });
        return { records: [] };
      },
    };
    const service = new Neo4jCanonicalProjectionService();
    const result = await service.applyEvent(session, {
      eventType: 'BIOMARKER_ASSOCIATION_UPSERTED',
      eventId: 'evt-1',
      payload: {
        biomarkerId: 'ba-1',
        orphaCode: 'ORPHA:324',
        analyte: { systemUri: 'https://www.genenames.org', code: 'HGNC:4296', display: 'GLA' },
        biomarkerRole: 'diagnostic',
      },
    });
    expect(result.projected).toBe(true);
    expect(runs[0].cypher).toMatch(/POSSUI_BIOMARCADOR/);
    expect(runs[0].params.numericOrpha).toBe('324');
    expect(runs[0].params.analyteCode).toBe('HGNC:4296');
  });

  it('skips projection when orpha or analyte missing', async () => {
    const service = new Neo4jCanonicalProjectionService();
    const result = await service.applyEvent(
      { run: async () => ({ records: [] }) },
      { eventType: 'BIOMARKER_ASSOCIATION_UPSERTED', payload: { analyte: {} } },
    );
    expect(result.skipped).toBe(true);
  });
});
