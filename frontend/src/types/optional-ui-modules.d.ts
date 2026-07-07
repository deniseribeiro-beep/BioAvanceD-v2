declare module '@radix-ui/react-tabs' {
  import type { ComponentType, ReactNode } from 'react';

  interface TabsProps {
    children?: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }

  interface TabProps {
    children?: ReactNode;
    value: string;
  }

  export const Tabs: ComponentType<TabsProps>;
  export const Tab: ComponentType<TabProps>;
}

declare module '@mui/x-data-grid' {
  import type { ComponentType } from 'react';

  interface DataGridProps {
    rows: unknown[];
    columns: unknown[];
    autoHeight?: boolean;
    getRowId: (row: Record<string, unknown>) => string | number;
  }

  export const DataGrid: ComponentType<DataGridProps>;
}

declare module '@mui/material' {
  import type { ChangeEvent, ComponentType, ReactNode } from 'react';

  interface BoxProps {
    children?: ReactNode;
    sx?: Record<string, unknown>;
  }

  interface TextFieldProps {
    children?: ReactNode;
    label?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    select?: boolean;
    size?: 'small' | 'medium';
    sx?: Record<string, unknown>;
    value?: string;
  }

  interface MenuItemProps {
    children?: ReactNode;
    value?: string;
  }

  export const Box: ComponentType<BoxProps>;
  export const TextField: ComponentType<TextFieldProps>;
  export const MenuItem: ComponentType<MenuItemProps>;
}
