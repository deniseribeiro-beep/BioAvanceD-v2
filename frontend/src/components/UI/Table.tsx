import { ReactNode, TableHTMLAttributes } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import './Table.css';

export type TableHeader = string | {
  label: string;
  sortable?: boolean;
  field?: string;
  className?: string;
};

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  headers?: TableHeader[];
  children: ReactNode;
  onSort?: (field: string) => void;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export default function Table({ headers, children, onSort, sortField, sortOrder, ...props }: TableProps) {
  const handleHeaderClick = (header: TableHeader) => {
    if (typeof header === 'object' && header.sortable && header.field && onSort) {
      onSort(header.field);
    }
  };

  const getSortIcon = (header: TableHeader) => {
    if (typeof header === 'object' && header.sortable && header.field) {
      if (sortField === header.field) {
        return sortOrder === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />;
      }
      return <ChevronUp size={16} style={{ opacity: 0.3 }} />;
    }
    return null;
  };

  // Backward compatibility: if headers is not provided, render children as-is
  // (assuming children contains thead/tbody structure)
  if (!headers) {
    return (
      <div className="table-container">
        <table className="table" {...props}>
          {children}
        </table>
      </div>
    );
  }

  // New API: render headers from prop
  return (
    <div className="table-container">
      <table className="table" {...props}>
        <thead>
          <tr>
            {headers.map((header, index) => {
              const label = typeof header === 'string' ? header : header.label;
              const sortable = typeof header === 'object' ? header.sortable : false;
              const className = typeof header === 'object' ? header.className : undefined;

              return (
                <th
                  key={index}
                  className={`${sortable ? 'sortable' : ''} ${className || ''}`.trim()}
                  onClick={() => handleHeaderClick(header)}
                  style={{
                    cursor: sortable ? 'pointer' : 'default',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>{label}</span>
                    {sortable && getSortIcon(header)}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
