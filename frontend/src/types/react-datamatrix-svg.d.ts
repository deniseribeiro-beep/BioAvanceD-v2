declare module 'react-datamatrix-svg' {
  import type { ComponentType } from 'react';

  const Datamatrix: ComponentType<{
    value: string;
    width?: number;
    height?: number;
    foreground?: string;
    background?: string;
  }>;

  export default Datamatrix;
}
