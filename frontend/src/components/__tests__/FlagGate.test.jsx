import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import FlagGate from '../FlagGate';

// useAuth is read for the owner bypass; keep it stubbed per-test.
const authState = { user: null };
vi.mock('../../auth', () => ({ useAuth: () => ({ user: authState.user }) }));

// Flags arrive exactly like AdminLayout passes them: through the parent
// route's <Outlet context={{ flags }} />.
function Layout({ flags }) {
  return <Outlet context={{ flags }} />;
}

const renderGate = (flags, flag = 'POLICY_ENGINE') => render(
  <MemoryRouter initialEntries={['/admin/policies']}>
    <Routes>
      <Route path="/admin" element={<Layout flags={flags} />}>
        <Route path="policies" element={
          <FlagGate flag={flag} label="Policy Engine"><div>ENGINE CONTENT</div></FlagGate>
        } />
      </Route>
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { authState.user = null; });
afterEach(() => { cleanup(); });

describe('FlagGate — owner-gated feature route wrapper', () => {
  it('renders the page while flags are still loading (fail-open)', () => {
    renderGate(undefined);
    expect(screen.getByText('ENGINE CONTENT')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-disabled')).not.toBeInTheDocument();
  });

  it('renders the page when the flag key is unknown to the response', () => {
    renderGate({ SOMETHING_ELSE: 0 });
    expect(screen.getByText('ENGINE CONTENT')).toBeInTheDocument();
  });

  it('renders the page when the flag is explicitly ON', () => {
    renderGate({ POLICY_ENGINE: true });
    expect(screen.getByText('ENGINE CONTENT')).toBeInTheDocument();
  });

  it('blocks with the disabled panel when the owner has the flag OFF', () => {
    renderGate({ POLICY_ENGINE: false });
    expect(screen.queryByText('ENGINE CONTENT')).not.toBeInTheDocument();
    const panel = screen.getByTestId('feature-disabled');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('data-flag', 'POLICY_ENGINE');
    expect(screen.getByText(/not enabled for your company/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
  });

  it('never blocks the platform owner, even with the flag OFF', () => {
    authState.user = { isOwner: true, role: 'admin' };
    renderGate({ POLICY_ENGINE: false });
    expect(screen.getByText('ENGINE CONTENT')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-disabled')).not.toBeInTheDocument();
  });

  it('blocks a company admin while OFF, unlocks after the owner enables it', () => {
    authState.user = { isOwner: false, role: 'admin' };
    const { rerender } = renderGate({ POLICY_ENGINE: false });
    expect(screen.queryByTestId('feature-disabled')).toBeInTheDocument();
    rerender(
      <MemoryRouter initialEntries={['/admin/policies']}>
        <Routes>
          <Route path="/admin" element={<Layout flags={{ POLICY_ENGINE: true }} />}>
            <Route path="policies" element={
              <FlagGate flag="POLICY_ENGINE" label="Policy Engine"><div>ENGINE CONTENT</div></FlagGate>
            } />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('ENGINE CONTENT')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-disabled')).not.toBeInTheDocument();
  });
});
