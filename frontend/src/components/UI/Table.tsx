import { ReactNode, TableHTMLAttributes } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import {
  Table as ShadcnTable,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/table';
import { cn } from '@/lib/utils';

export type TableHeaderCell =
  | string
  | {
      label: string;
      sortable?: boolean;
      field?: string;
      className?: string;
    };

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  headers?: TableHeaderCell[];
  children: ReactNode;
  onSort?: (field: string) => void;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export default function Table({
  headers,
  children,
  onSort,
  sortField,
  sortOrder,
  className,
  ...props
}: TableProps) {
  const handleHeaderClick = (header: TableHeaderCell) => {
    if (typeof header === 'object' && header.sortable && header.field && onSort) {
      onSort(header.field);
    }
  };

  const getSortIcon = (header: TableHeaderCell) => {
    if (typeof header === 'object' && header.sortable && header.field) {
      if (sortField === header.field) {
        return sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
      }
      return <ChevronUp size={14} className="opacity-30" />;
    }
    return null;
  };

  if (!headers) {
    return (
      <ShadcnTable className={cn(className)} {...props}>
        {children}
      </ShadcnTable>
    );
  }

  return (
    <ShadcnTable className={cn(className)} {...props}>
      <TableHeader>
        <TableRow>
          {headers.map((header, index) => {
            const label = typeof header === 'string' ? header : header.label;
            const sortable = typeof header === 'object' ? header.sortable : false;
            const headerClassName = typeof header === 'object' ? header.className : undefined;

            return (
              <TableHead
                key={index}
                className={cn(sortable && 'cursor-pointer select-none', headerClassName)}
                onClick={() => handleHeaderClick(header)}
              >
                <div className="flex items-center gap-1.5">
                  <span>{label}</span>
                  {sortable ? getSortIcon(header) : null}
                </div>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </ShadcnTable>
  );
}
