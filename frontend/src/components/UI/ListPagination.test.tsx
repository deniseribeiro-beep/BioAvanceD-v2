import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListPagination from './ListPagination';

describe('ListPagination', () => {
  it('renders the range summary and navigates pages', async () => {
    const onPageChange = vi.fn();
    render(
      <ListPagination
        currentPage={1}
        totalPages={3}
        pageStart={1}
        pageEnd={10}
        total={25}
        onPageChange={onPageChange}
        testIdPrefix="demo-pagination"
      />,
    );

    expect(screen.getByTestId('demo-pagination-summary')).toHaveTextContent('Mostrando 1–10 de 25');
    expect(screen.getByTestId('demo-pagination-page')).toHaveTextContent('Página 1 de 3');
    expect(screen.getByTestId('demo-pagination-prev')).toBeDisabled();

    await userEvent.click(screen.getByTestId('demo-pagination-next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('shows the empty label when total is zero', () => {
    render(
      <ListPagination
        currentPage={1}
        totalPages={1}
        pageStart={0}
        pageEnd={0}
        total={0}
        onPageChange={vi.fn()}
        emptyLabel="Nada aqui"
      />,
    );
    expect(screen.getByTestId('list-pagination-summary')).toHaveTextContent('Nada aqui');
  });
});
