import type { CSSProperties } from 'react';

export interface FhirImportQualitySummaryData {
  categoryA?: number;
  categoryB?: number;
  categoryC?: number;
  quarantinedTechnical?: number;
  averageScore?: number | null;
}

interface FhirImportQualitySummaryProps {
  summary?: FhirImportQualitySummaryData | null;
  style?: CSSProperties;
}

export default function FhirImportQualitySummary({ summary, style }: FhirImportQualitySummaryProps) {
  if (!summary) return null;

  return (
    <div style={{ marginTop: 6, ...style }}>
      Qualidade: A={summary.categoryA || 0} | B={summary.categoryB || 0} | C={summary.categoryC || 0}
      {' '}| Quarentena Técnica={summary.quarantinedTechnical || 0}
      {' '}| Score Médio={summary.averageScore ?? '-'}
    </div>
  );
}
