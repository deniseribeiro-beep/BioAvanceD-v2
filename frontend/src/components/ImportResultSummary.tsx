import type { CSSProperties } from 'react';
import FhirImportQualitySummary, { type FhirImportQualitySummaryData } from './FhirImportQualitySummary';

export interface ImportResultSummaryData {
  success?: boolean;
  message?: string;
  patients?: number;
  samples?: number;
  consents?: number;
  error?: string;
  qualitySummary?: FhirImportQualitySummaryData | null;
}

interface ImportResultSummaryProps {
  result?: ImportResultSummaryData | null;
  style?: CSSProperties;
  qualityStyle?: CSSProperties;
  defaultMessage?: string;
}

export default function ImportResultSummary({
  result,
  style,
  qualityStyle,
  defaultMessage = 'Importação concluída!',
}: ImportResultSummaryProps) {
  if (!result) return null;

  const isError = result.success === false || Boolean(result.error);

  return (
    <div
      style={{
        color: isError ? '#dc2626' : '#16a34a',
        fontSize: 14,
        marginTop: 8,
        ...style,
      }}
    >
      {isError ? result.error : result.message || defaultMessage}
      {result.patients !== undefined && (
        <div>
          Pacientes: {result.patients} | Amostras: {result.samples} | Consents: {result.consents}
        </div>
      )}
      <FhirImportQualitySummary summary={result.qualitySummary || undefined} style={qualityStyle} />
    </div>
  );
}
