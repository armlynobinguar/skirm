import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteLoading } from './RouteLoading';

describe('RouteLoading', () => {
  it('is one labelled status with panels for its layout', () => {
    const { container, unmount } = render(<RouteLoading layout="grid" label="Loading the Exchange" />);
    expect(screen.getByRole('status', { name: 'Loading the Exchange' })).toHaveAttribute('data-layout', 'grid');
    expect(container.querySelectorAll('.app-route-loading-panel')).toHaveLength(6);
    unmount();
    render(<RouteLoading layout="table" />);
    expect(screen.getByRole('status', { name: 'Loading' }).querySelectorAll('.app-route-loading-row')).toHaveLength(8);
  });
});
