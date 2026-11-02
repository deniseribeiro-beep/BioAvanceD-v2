import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// #1430: App.tsx registers a top-level `/samples/:id` route ahead of the `/*`
// layout route, whose descendant <Routes> hold the sample sub-pages. Without
// their own top-level entries, `/samples/custody-reports` and
// `/samples/withdrawal-return` were caught by the detail page as an :id; the
// three-segment sub-pages are pinned here against a regression.
vi.mock('./components/Layout/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./views/SampleDetailsPage', () => ({ default: () => <p>page:detail</p> }));
vi.mock('./views/SampleCustodyReportsPage', () => ({ default: () => <p>page:custody-reports</p> }));
vi.mock('./views/SampleWithdrawalReturnPage', () => ({ default: () => <p>page:withdrawal-return</p> }));
vi.mock('./views/SampleLabelPage', () => ({ default: () => <p>page:label</p> }));
vi.mock('./views/SampleChainPage', () => ({ default: () => <p>page:chain</p> }));
vi.mock('./views/SampleMovementsPage', () => ({ default: () => <p>page:movements</p> }));

import App from './App';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('sample routes in App.tsx', () => {
  it.each([
    ['/samples/custody-reports', 'page:custody-reports'],
    ['/samples/withdrawal-return', 'page:withdrawal-return'],
    ['/samples/S-1/label', 'page:label'],
    ['/samples/S-1/chain', 'page:chain'],
    ['/samples/S-1/movements', 'page:movements'],
    ['/samples/S-1', 'page:detail'],
  ])('%s renders %s', async (url, page) => {
    window.history.pushState({}, '', url);
    render(<App />);

    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(screen.queryAllByText(/^page:/)).toHaveLength(1);
  });
});
