import React from 'react';
import type { SampleLabelData } from '../types/labels';
import Datamatrix from 'react-datamatrix-svg';

interface CryoLabelPrinterProps {
  samples: SampleLabelData[];
}

const formatLocation = (sample: SampleLabelData) => {
  // Exemplo: FZ1-CX4-B4
  return `${sample.equipmentLabel || sample.equipmentId}-${sample.boxLabel || sample.boxId}-${sample.coordinate}`;
};

export const CryoLabelPrinter: React.FC<CryoLabelPrinterProps> = ({ samples }) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="cryo-label-printer">
      <div className="print-controls no-print">
        <button onClick={handlePrint}>Imprimir Lote</button>
      </div>
      <div className="labels-sheet">
        {samples.map((sample) => (
          <div className="cryo-label" key={sample.sampleId}>
            <div className="datamatrix-container">
              <Datamatrix
                value={sample.sampleId}
                width={60}
                height={60}
                foreground="#000"
                background="#fff"
              />
            </div>
            <div className="label-info">
              <div className="sample-id">{sample.sampleId}</div>
              <div className="date">{sample.date ? new Date(sample.date).toLocaleDateString() : ''}</div>
              <div className="location">{formatLocation(sample)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CryoLabelPrinter;
