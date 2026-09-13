import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnalysisUpload from './AnalysisUpload.jsx';

// #1019: this is the repo's first test to RENDER a `.jsx` component. Before the
// fix, `frontend/vitest.config.js` carried no `plugins` key while
// `vite.config.js` loads `@vitejs/plugin-react`, so `.jsx` went through the
// CLASSIC JSX transform under vitest and emitted `React.createElement` with no
// `React` binding in scope -- `ReferenceError: React is not defined`, thrown
// from AnalysisUpload.jsx itself. 6 of the 7 `.jsx` files under `frontend/src`
// have no default React import, so this pins the whole class, not this file.
vi.mock('../services/api', () => ({
  analysisFileService: {
    upload: vi.fn(),
    validateSample: vi.fn(),
  },
}));

describe('AnalysisUpload under vitest', () => {
  // Control case (#695): behaviour is identical before and after the fix, so
  // this must be GREEN pre-fix. A red control would mean the harness/jsdom
  // setup is broken rather than the JSX transform.
  it('renders a .tsx element -- control, unaffected by the plugin', () => {
    render(<div data-testid="control">ok</div>);
    expect(screen.getByTestId('control')).toBeInTheDocument();
  });

  it('#1019: renders a .jsx component without ReferenceError: React is not defined', () => {
    expect(() => render(<AnalysisUpload />)).not.toThrow();
  });
});
