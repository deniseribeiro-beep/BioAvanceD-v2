export interface SampleLabelData {
  sampleId: string;
  equipmentId: string;
  boxId: string;
  coordinate: string;
  equipmentLabel?: string;
  boxLabel?: string;
  date?: string | Date;
  labelPrinted?: boolean;
}
