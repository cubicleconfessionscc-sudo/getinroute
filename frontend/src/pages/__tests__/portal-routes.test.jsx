import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import App from '../../App';
import { AuthProvider } from '../../auth.jsx';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>
);

afterEach(() => { cleanup(); });

describe('V3.3 public website routing', () => {
  it('/login shows the role-selection portal', () => {
    renderAt('/login');
    expect(screen.getByText('Welcome to GetInRoute')).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: '.portal-role-title' })).toBeInTheDocument();
    expect(screen.getByText('Company', { selector: '.portal-role-title' })).toBeInTheDocument();
    expect(screen.getByText('Vendor', { selector: '.portal-role-title' })).toBeInTheDocument();
    expect(screen.getByText('School', { selector: '.portal-role-title' })).toBeInTheDocument();
  });

  it('/admin/login renders the admin portal', () => {
    renderAt('/admin/login');
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Admin Portal')).toBeInTheDocument();
  });

  it('/company/login renders the company portal', () => {
    renderAt('/company/login');
    expect(screen.getByText('Company Sign In')).toBeInTheDocument();
  });

  it('/vendor/login renders the vendor portal', () => {
    renderAt('/vendor/login');
    expect(screen.getByText('Vendor Portal')).toBeInTheDocument();
  });

  it('/school/login renders the school portal', () => {
    renderAt('/school/login');
    expect(screen.getByText('School Sign In')).toBeInTheDocument();
  });

  it('/apps renders the app download page', () => {
    renderAt('/apps');
    expect(screen.getByText('GetInRoute Employee')).toBeInTheDocument();
    expect(screen.getByText('GetInRoute Driver')).toBeInTheDocument();
    expect(screen.getByText('GetInRoute Parent')).toBeInTheDocument();
    expect(screen.getByText('GetInRoute School')).toBeInTheDocument();
  });

  it('/get-started redirects to the 10-day trial onboarding', () => {
    renderAt('/get-started');
    expect(screen.getByText(/10-Day Free Trial/)).toBeInTheDocument();
  });

  it('/register-company shows the onboarding wizard step 1', () => {
    renderAt('/register-company');
    expect(screen.getByText('Company Information')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Acme Corp')).toBeInTheDocument();
  });

  it('unknown routes fall back to the landing page', () => {
    renderAt('/some-unknown-path');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});