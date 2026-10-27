import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import CompanyOnboard from '../CompanyOnboard';

afterEach(() => { /* testing-library auto-cleans via vitest setup */ });

function renderWizard() {
  return render(<MemoryRouter initialEntries={['/register-company']}><CompanyOnboard /></MemoryRouter>);
}

describe('Company registration — location invite code', () => {
  it('offers a per-location invite code field and an easy address picker in the States/Cities step', { timeout: 15000 }, () => {
    renderWizard();

    fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
    fireEvent.change(screen.getByPlaceholderText('acme.com'), { target: { value: 'acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    // Step 2 — add a state, then a city, to reveal the location editor.
    fireEvent.click(screen.getByRole('button', { name: 'Karnataka' }));

    const cityInput = screen.getByPlaceholderText('Add a city (e.g. Bengaluru)');
    fireEvent.change(cityInput, { target: { value: 'Bengaluru' } });
    fireEvent.click(screen.getByRole('button', { name: /Add city/i }));

    // The invite code input is present for the location being added.
    const codeInput = screen.getByLabelText('Invite code for this location');
    expect(codeInput).toBeInTheDocument();
    expect(codeInput).toHaveAttribute('placeholder', expect.stringContaining('auto-generate'));

    // Modern address entry: search, "use my location" and "pick on map".
    expect(screen.getByTestId('address-search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use my location/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pick on map/i })).toBeInTheDocument();

    // Typing a code is reflected and normalised to upper-case.
    fireEvent.change(codeInput, { target: { value: 'blr-hq-2026' } });
    expect(codeInput.value).toBe('BLR-HQ-2026');
  });
});
