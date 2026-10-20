import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ViewOnMapLink from '../ViewOnMapLink';

describe('ViewOnMapLink', () => {
  it('links to Google Maps by coordinates when they exist', () => {
    cleanup();
    render(<ViewOnMapLink lat={12.9716} lng={77.5946} address="Bengaluru" />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=12.9716,77.5946');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveTextContent('View on Google Maps');
  });

  it('falls back to the address text when coordinates are missing', () => {
    cleanup();
    render(<ViewOnMapLink lat={null} lng={null} address="Whitefield, Bengaluru" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Whitefield%2C%20Bengaluru'
    );
  });

  it('renders nothing when there is neither a point nor an address', () => {
    cleanup();
    const { container } = render(<ViewOnMapLink lat={null} lng={null} address="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
