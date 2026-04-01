import { z } from 'zod';

// Base schema for a single intake record
export const intakeSchema = z.object({
  sample: z.object({
    additive: z.string(),
    fillStatus: z.string(),
    transportTemp: z.string(),
    condition: z.string(),
  }),
  test: z.object({
    type: z.string(),
    category: z.string(),
  }),
});

// Add cross-field clinical rules using superRefine
export const intakeSchemaWithRules = intakeSchema.superRefine((data, ctx) => {
  // Heparin Rule
  if (data.sample.additive === 'Heparin' && data.test.type === 'PCR') {
    ctx.addIssue({
      path: ['sample', 'additive'],
      message: 'Heparina inibe a PCR. Utilize EDTA.',
      code: z.ZodIssueCode.custom,
    });
  }

  // Coagulation (Citrate) Rule
  if (data.test.category === 'Coagulation' && data.sample.fillStatus === 'Underfilled') {
    ctx.addIssue({
      path: ['sample', 'fillStatus'],
      message: 'Tubo de citrato com volume insuficiente altera os tempos de coagulação. Exigir recoleta.',
      code: z.ZodIssueCode.custom,
    });
  }

  // Stability (Ice) Rule
  if ((data.test.type.includes('Ammonia') || data.test.type.includes('Lactate')) &&
      !(data.sample.transportTemp === 'Refrigerated' || data.sample.transportTemp === 'Ice')) {
    ctx.addIssue({
      path: ['sample', 'transportTemp'],
      message: 'Analito instável. A amostra deve ser transportada no gelo.',
      code: z.ZodIssueCode.custom,
    });
  }

  // Hemolysis Rule
  if (data.sample.condition === 'Hemolyzed' &&
      (data.test.type.includes('Potassium') || data.test.type.includes('LDH'))) {
    ctx.addIssue({
      path: ['sample', 'condition'],
      message: 'Hemólise causa falso aumento intracelular. Teste bloqueado.',
      code: z.ZodIssueCode.custom,
    });
  }
});

// Batch validation utility
export function validateBatchIntake(dataArray) {
  const result = z.array(intakeSchemaWithRules).safeParse(dataArray);
  const validRecords = [];
  const errorReports = [];

  if (result.success) {
    return { validRecords: result.data, errorReports };
  }

  // Collect errors for each record
  result.error.errors.forEach((err) => {
    const idx = err.path[0];
    errorReports.push({
      index: idx,
      message: err.message,
      path: err.path.slice(1),
    });
  });

  // Filter out invalid records
  dataArray.forEach((rec, i) => {
    if (!errorReports.find(e => e.index === i)) {
      validRecords.push(rec);
    }
  });

  return { validRecords, errorReports };
}
