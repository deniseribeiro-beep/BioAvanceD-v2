import React from 'react';
import { SampleLabelData } from '../types/labels';
import CryoLabelPrinter from './CryoLabelPrinter';

interface PrintQueueDashboardProps {
  samples: SampleLabelData[];
  onPrint: (sampleIds: string[]) => void;
}

export const PrintQueueDashboard: React.FC<PrintQueueDashboardProps> = ({ samples, onPrint }) => {
  const samplesToPrint = samples.filter(s => !s.labelPrinted);

  return (
    <div>
      <h2>Fila de Impressão de Etiquetas</h2>
      {samplesToPrint.length === 0 ? (
        <div>Nenhuma amostra pendente de impressão.</div>
      ) : (
        <>
          <CryoLabelPrinter samples={samplesToPrint} />
          <button onClick={() => onPrint(samplesToPrint.map(s => s.sampleId))}>
            Marcar como Impresso
          </button>
        </>
      )}
    </div>
  );
};

export default PrintQueueDashboard;
