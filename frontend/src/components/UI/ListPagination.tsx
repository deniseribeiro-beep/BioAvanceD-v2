import Button from './Button';

type ListPaginationProps = {
  currentPage: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  total: number;
  onPageChange: (page: number) => void;
  testIdPrefix?: string;
  emptyLabel?: string;
};

export default function ListPagination({
  currentPage,
  totalPages,
  pageStart,
  pageEnd,
  total,
  onPageChange,
  testIdPrefix = 'list-pagination',
  emptyLabel = 'Nenhum item exibido',
}: ListPaginationProps) {
  if (total === 0) {
    return (
      <div className="samples-pagination" data-testid={testIdPrefix}>
        <div className="samples-pagination__summary" data-testid={`${testIdPrefix}-summary`}>
          {emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="samples-pagination" data-testid={testIdPrefix}>
      <div className="samples-pagination__summary" data-testid={`${testIdPrefix}-summary`}>
        Mostrando {pageStart}–{pageEnd} de {total}
      </div>
      <div className="samples-pagination__controls">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          data-testid={`${testIdPrefix}-prev`}
        >
          Anterior
        </Button>
        <span className="samples-pagination__page" data-testid={`${testIdPrefix}-page`}>
          Página {currentPage} de {totalPages}
        </span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          data-testid={`${testIdPrefix}-next`}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
