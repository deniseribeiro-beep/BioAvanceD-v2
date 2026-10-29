import type { CSSProperties } from 'react';
import RcsScopeNotice from './RcsScopeNotice';

export interface FhirImportQualitySummaryData {
  gradeA?: number;
  gradeB?: number;
  gradeC?: number;
  gradeD?: number;
  gradeE?: number;
  governanceFailures?: number;
  averageRcsScore?: number | null;
  // Deprecated legacy fields; kept only while older import responses are phased out.
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

  const gradeA = summary.gradeA ?? 0;
  const gradeB = summary.gradeB ?? 0;
  const gradeC = summary.gradeC ?? 0;
  const gradeD = summary.gradeD ?? 0;
  const gradeE = summary.gradeE ?? 0;
  const averageRcsScore = summary.averageRcsScore ?? '-';

  return (
    <div style={{ marginTop: 6, ...style }}>
      Qualidade: A={gradeA} | B={gradeB} | C={gradeC} | D={gradeD} | E={gradeE}
      {' '}| Falha Governança={summary.governanceFailures ?? 0}
      {' '}| RCS Médio={averageRcsScore}
      <RcsScopeNotice />
    </div>
  );
}
