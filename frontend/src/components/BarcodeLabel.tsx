import Barcode from 'react-barcode';

export type BarcodeLabelProps = {
  sampleId: string | number;
  barcode?: string;
  acronym?: string;
};

// Visual component for physical freezer labels (5cm x 2.5cm)
export default function BarcodeLabel({ sampleId, barcode, acronym }: BarcodeLabelProps) {
  const resolvedCode = barcode || String(sampleId);

  return (
    <div
      className="barcode-label"
      style={{
        width: '5cm',
        height: '2.5cm',
        padding: '6px',
        border: '1px solid #000',
        background: '#fff',
        color: '#000',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '4px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          textAlign: 'center',
          letterSpacing: '0.5px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        aria-label="Acrônimo do paciente ou tipo de amostra"
      >
        {acronym || 'AMOSTRA'}
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Barcode
          value={resolvedCode}
          format="CODE128"
          displayValue={false}
          background="#fff"
          lineColor="#000"
          height={38}
          width={1.6}
          margin={0}
        />
      </div>

      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          textAlign: 'center',
          letterSpacing: '1px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        aria-label="Identificador da amostra"
      >
        {sampleId}
      </div>
    </div>
  );
}
