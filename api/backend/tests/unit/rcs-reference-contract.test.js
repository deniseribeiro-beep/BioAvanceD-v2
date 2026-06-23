import { describe, expect, it, vi } from 'vitest';

const referenceData = require('../../src/services/rcs-reference-data');
const { upsertCollection } = require('../../src/seeders');

const catalogCodes = {
  fluid: {
    sampleType: 'ASC AMN BAL BLD BMA BMK BUC BUF BFF CEL CEN CLN CRD CSF DWB NAS PEL PEN PFL PL1 PL2 RBC SAL SEM SER SPT STL SYN TER U24 URN URM URT ZZZ',
    primaryContainer: 'ACD ADD CAT CPD CPT EDG HEP HIR LHG ORG PAX PED PET PI1 PIX PPS PXD PXR SCI SED SHP SPO SST TEM TRC XXX ZZZ',
    Ppre: 'A B C D E F G H I J K L M N O X Z',
    Pcent1: 'A B C D E F G H I J M N X Z',
    Pcent2: 'A B C D E F G H I J N X Z',
    Ppost: 'A B C D E F G H I J N X Z',
    Pstore: 'A B V C D E F G H I J K L M N O P Q R S T W Y X Z',
  },
  solid: {
    sampleType: 'CEN CLN FNA HAR LCM PEN PLC TIS TCM ZZZ',
    primaryContainer: 'A06 A12 A24 A48 A72 BCM BPS BSL BTM FNA PUN SCM SRG SSL STM VAC SWB ZZZ',
    Pwarm: 'A B C D E F X N Z',
    Pcold: 'A B C D E F X N Z',
    Pfix: 'ACA ALD ALL ETH FOR HST SNP NAA NBF OCT PXT RNL XXX ZZZ',
    PfixTime: 'A B C D E F G N X Z',
    Pstore: 'A B V C D E F G H I J K L M N O P Q R S T W Y X Z',
  },
};

const severityRows = [
  ['fluid','Ppre','A B',0], ['fluid','Ppre','C D',.2], ['fluid','Ppre','E F',.4], ['fluid','Ppre','G H',.6], ['fluid','Ppre','I J',.8], ['fluid','Ppre','K L',.9], ['fluid','Ppre','M N',1], ['fluid','Ppre','O',.25],
  ['fluid','Pcent1','A B C D',0], ['fluid','Pcent1','E F',.33], ['fluid','Pcent1','G H',.66], ['fluid','Pcent1','I J',1], ['fluid','Pcent1','M',.5],
  ['fluid','Pcent1','N',0,'pcent1_no_centrifugation_acceptable'], ['fluid','Pcent1','N',1,'pcent1_no_centrifugation_incompatible'],
  ['fluid','Pcent2','A B C D',0], ['fluid','Pcent2','E F',.33], ['fluid','Pcent2','G H',.66], ['fluid','Pcent2','I J',1],
  ['fluid','Pcent2','N',0,'pcent2_not_required'], ['fluid','Pcent2','N',.25,'pcent2_optional_routine'], ['fluid','Pcent2','N',1,'pcent2_required_low_cell'],
  ['fluid','Ppost','A B',0], ['fluid','Ppost','C D',.25], ['fluid','Ppost','E F',.5], ['fluid','Ppost','G H',.75], ['fluid','Ppost','I J',1], ['fluid','Ppost','N',0],
  ['solid','Pwarm','A',0], ['solid','Pwarm','B',.2], ['solid','Pwarm','C',.4], ['solid','Pwarm','D',.6], ['solid','Pwarm','E',.8], ['solid','Pwarm','F',1], ['solid','Pwarm','N',0],
  ['solid','Pcold','A',0], ['solid','Pcold','B',.2], ['solid','Pcold','C',.4], ['solid','Pcold','D',.6], ['solid','Pcold','E',.8], ['solid','Pcold','F',1], ['solid','Pcold','N',0],
  ['solid','Pfix','SNP PXT RNL ALL HST',0], ['solid','Pfix','NBF OCT',.33], ['solid','Pfix','FOR ALD ETH ACA NAA',.66], ['solid','Pfix','*',1,'pfix_incompatible_workflow'],
  ['solid','PfixTime','B',0], ['solid','PfixTime','A',.5], ['solid','PfixTime','C',.2], ['solid','PfixTime','D',.4], ['solid','PfixTime','E',.6], ['solid','PfixTime','F',.8], ['solid','PfixTime','G',1], ['solid','PfixTime','N',0],
  ['fluid','Pstore','C F Q V W E I',0], ['solid','Pstore','C F Q V W E I',0],
  ['fluid','Pstore','A D G J L S N O',.25], ['solid','Pstore','A D G J L S N O',.25],
  ['fluid','Pstore','B H K M T',.6], ['solid','Pstore','B H K M T',.6],
  ['fluid','Pstore','Y',.25,'storage_y_ultralow_documented'], ['solid','Pstore','Y',.25,'storage_y_ultralow_documented'],
  ['fluid','Pstore','Y',.6,'storage_y_minus35_documented'], ['solid','Pstore','Y',.6,'storage_y_minus35_documented'],
  ['fluid','Pstore','Y',null,'storage_y_unresolved'], ['solid','Pstore','Y',null,'storage_y_unresolved'],
  ['fluid','Pstore','P R',.25,'storage_pr_compatible'], ['solid','Pstore','P R',.25,'storage_pr_compatible'],
  ['fluid','Pstore','P R',1,'storage_pr_incompatible'], ['solid','Pstore','P R',1,'storage_pr_incompatible'],
  ['fluid','Pstore','P R',null,'storage_pr_unresolved'], ['solid','Pstore','P R',null,'storage_pr_unresolved'],
  ['any','any','X XXX',null], ['any','any','Z ZZZ',null], ['any','any','SEMANTIC_INCOMPATIBILITY',null],
];

function signature(row) {
  return [row.matrix_type, row.axis_code, [...row.sprec_codes].sort().join(','), row.severity_value, row.workflow_rule || ''].join('|');
}

describe('RCS-GOV 1.0 reference contract (Supplementary Tables S1-S3)', () => {
  it('transcreve integralmente os catalogos SPREC S1 e S2', () => {
    for (const [matrix, axes] of Object.entries(catalogCodes)) {
      for (const [axis, codes] of Object.entries(axes)) {
        const actual = referenceData.catalogs[matrix]
          .filter((item) => item.axis_code === axis)
          .map((item) => item.sprec_code)
          .sort();
        expect(actual).toEqual(codes.split(' ').sort());
      }
    }
  });

  it('transcreve integralmente as 75 regras de severidade da S3', () => {
    const expected = severityRows.map(([matrix_type, axis_code, codes, severity_value, workflow_rule = '']) => ({
      matrix_type,
      axis_code,
      sprec_codes: String(codes).split(' '),
      severity_value,
      workflow_rule,
    })).map(signature).sort();
    expect(referenceData.severityMappings.map(signature).sort()).toEqual(expected);
    for (const mapping of referenceData.severityMappings) {
      if (mapping.severity_value === null) {
        expect(mapping.is_scored).toBe(false);
        expect(mapping.governance_action).toBe('governance_failure');
      } else {
        expect(mapping.is_scored).toBe(true);
        expect(mapping.severity_value).toBeGreaterThanOrEqual(0);
        expect(mapping.severity_value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('mantem pesos, thresholds e regras de governanca versionados', () => {
    expect(referenceData.model_code).toBe('RCS-GOV-1.0');
    expect(referenceData.sprec_version).toBe('SPREC-2.0');
    expect(referenceData.weights.map(({ matrix_type, axis_code, weight }) => [matrix_type, axis_code, weight])).toEqual([
      ['fluid','Ppre',30], ['fluid','Pcent1',15], ['fluid','Pcent2',10], ['fluid','Ppost',20], ['fluid','Pstore',25],
      ['solid','Pwarm',25], ['solid','Pcold',25], ['solid','Pfix',15], ['solid','PfixTime',20], ['solid','Pstore',15],
    ]);
    expect(referenceData.thresholds.map(({ grade, min_inclusive, max_exclusive }) => [grade, min_inclusive, max_exclusive])).toEqual([
      ['A',90,null], ['B',80,90], ['C',65,80], ['D',50,65], ['E',null,50],
    ]);
    expect(referenceData.governanceRules.map((rule) => rule.rule_code)).toEqual(expect.arrayContaining([
      'MISSING_CRITICAL_METADATA', 'UNKNOWN_SPREC_CODE', 'INVALID_SPREC_CODE', 'MATRIX_INCOMPATIBLE_CODE',
      'OTHER_WITHOUT_LOCAL_INTERPRETATION', 'INSUFFICIENT_DOCUMENTATION', 'INSUFFICIENT_TRACEABILITY',
      'MISSING_REQUIRED_MONITORING', 'SEMANTIC_INCOMPATIBILITY', 'MISSING_ANALYTICAL_WORKFLOW', 'NOT_SCORED',
    ]));
  });

  it('executa upsert idempotente sem duplicar chaves logicas', async () => {
    const stored = new Map();
    const collection = {
      bulkWrite: vi.fn(async (operations) => {
        for (const { updateOne } of operations) {
          const key = JSON.stringify(updateOne.filter);
          stored.set(key, { ...(stored.get(key) || {}), ...updateOne.update.$setOnInsert, ...updateOne.update.$set });
        }
      }),
    };
    const docs = referenceData.weights.map((item) => ({ ...item }));
    const keys = ['model_code', 'sprec_version', 'matrix_type', 'axis_code'];
    await upsertCollection(collection, keys, docs);
    await upsertCollection(collection, keys, docs);
    expect(stored.size).toBe(10);
    expect(collection.bulkWrite).toHaveBeenCalledTimes(2);
  });
});
