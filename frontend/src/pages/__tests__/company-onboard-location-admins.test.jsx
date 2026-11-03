import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import CompanyOnboard from '../CompanyOnboard';

// Walks the wizard to Step 3 (Administrator Information) with one place
// chosen in Step 2: Karnataka > Bengaluru > "Bengaluru Head Office".
// Geocoding is unavailable in jsdom, so add() falls back to the typed name
// and files the location under the card's own state/city.
async function walkToStep3() {
  render(<MemoryRouter initialEntries={['/register-company']}><CompanyOnboard /></MemoryRouter>);

  fireEvent.change(screen.getByPlaceholderText('Acme Corp'), { target: { value: 'Acme Corp' } });
  fireEvent.change(screen.getByPlaceholderText('acme.com'), { target: { value: 'acme.com' } });
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

  // Step 2 — state, city, location.
  fireEvent.click(screen.getByRole('button', { name: 'Karnataka' }));
  fireEvent.change(screen.getByPlaceholderText('Add a city (e.g. Bengaluru)'), { target: { value: 'Bengaluru' } });
  fireEvent.click(screen.getByRole('button', { name: /Add city/i }));
  fireEvent.change(screen.getByPlaceholderText('e.g. "Bengaluru Head Office"'), { target: { value: 'Bengaluru Head Office' } });
  fireEvent.click(screen.getByRole('button', { name: /Add location/i }));

  const continueBtn = await waitFor(
    () => {
      const b = screen.getByRole('button', { name: /Continue/i });
      expect(b).toBeEnabled();
      return b;
    },
    { timeout: 10000 }
  );
  fireEvent.click(continueBtn);

  // Step 3 must render the per-location administrator card.
  expect(await screen.findByText('Administrator for each location (optional)')).toBeInTheDocument();
  return continueBtn;
}

function fillPrimaryAdmin() {
  const names = screen.getAllByPlaceholderText('Full name');
  const emails = screen.getAllByPlaceholderText('admin@acme.com');
  const pws = screen.getAllByPlaceholderText('Min 8 characters');
  fireEvent.change(names[0], { target: { value: 'Acme Owner' } });
  fireEvent.change(emails[0], { target: { value: 'owner@acme.com' } });
  fireEvent.change(pws[0], { target: { value: 'OwnerPass123' } });
}

describe('Company registration — per-location administrators (Step 3)', () => {
  it('offers one admin card per chosen place and gates Continue on complete cards', { timeout: 20000 }, async () => {
    await walkToStep3();

    // A second set of Full name / email / password fields exists — one per
    // location chosen in Step 2 — alongside the primary admin's own fields.
    expect(screen.getAllByPlaceholderText('Full name')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('admin@acme.com')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('Min 8 characters')).toHaveLength(2);

    // The card is labelled with the place it administers.
    expect(screen.getAllByText('Bengaluru Head Office').length).toBeGreaterThan(0);
    expect(screen.getByText(/Bengaluru, Karnataka/)).toBeInTheDocument();

    // Blank card + complete primary admin => Continue enabled (cards are
    // optional and a fully blank card is skipped).
    fillPrimaryAdmin();
    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    expect(continueBtn).toBeEnabled();

    // A half-filled card blocks Continue until all three fields are present.
    const cardNames = screen.getAllByPlaceholderText('Full name');
    fireEvent.change(cardNames[1], { target: { value: 'Ravi Kumar' } });
    expect(continueBtn).toBeDisabled();

    const cardEmails = screen.getAllByPlaceholderText('admin@acme.com');
    fireEvent.change(cardEmails[1], { target: { value: 'ravi@acme.com' } });
    expect(continueBtn).toBeDisabled();

    const cardPws = screen.getAllByPlaceholderText('Min 8 characters');
    fireEvent.change(cardPws[1], { target: { value: 'LocPass123' } });
    expect(continueBtn).toBeEnabled();

    // Advance to Review — the filled location admin must be listed there.
    fireEvent.click(continueBtn);
    expect(await screen.findByText('Location admins:')).toBeInTheDocument();
    expect(screen.getByText(/Ravi Kumar/)).toBeInTheDocument();
    expect(screen.getByText(/ravi@acme.com/)).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru Head Office, Bengaluru, Karnataka/)).toBeInTheDocument();
  }, 20000);
});
