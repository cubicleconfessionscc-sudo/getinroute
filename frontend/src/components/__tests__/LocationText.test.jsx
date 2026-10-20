import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LocationText from '../LocationText';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/api/geo/reverse')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ address: 'Resolved Street, Bengaluru' }) };
    }
    throw new Error('unexpected fetch ' + url);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('LocationText', () => {
  it('shows the stored address name when one exists', () => {
    render(<LocationText lat={12.9} lng={77.6} address="Indiranagar, Bengaluru" />);
    expect(screen.getByText('Indiranagar, Bengaluru')).toBeInTheDocument();
  });

  it('resolves a name when only coordinates are stored', async () => {
    render(<LocationText lat={37.422} lng={-122.084} address="" />);
    expect(await screen.findByText('Resolved Street, Bengaluru')).toBeInTheDocument();
  });

  it('treats a coordinate-shaped "address" as missing and resolves instead', async () => {
    render(<LocationText lat={37.422} lng={-122.084} address="37.42200, -122.08400" />);
    expect(await screen.findByText('Resolved Street, Bengaluru')).toBeInTheDocument();
  });

  it('falls back to coordinates only when the provider cannot name the point', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(null) })));
    render(<LocationText lat={12.9716} lng={77.5946} address="" />);
    expect(await screen.findByText('12.97160, 77.59460')).toBeInTheDocument();
  });

  it('renders an em dash when there is nothing to show', () => {
    render(<LocationText lat={null} lng={null} address="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
