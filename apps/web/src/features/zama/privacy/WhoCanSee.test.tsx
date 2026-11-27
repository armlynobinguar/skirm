import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { VISIBILITY, type VisibilityTopic } from './visibility';
import { SealBadge, WhoCanSee } from './WhoCanSee';

describe('who can see this', () => {
  it('opens to every value of its topic', async () => {
    render(<WhoCanSee topic="fog" />);
    const details = screen.getByTestId('zama-who-fog');
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Who can see this?'));
    expect(details).toHaveAttribute('open');
    for (const r of VISIBILITY.fog) expect(screen.getByText(r.who)).toBeInTheDocument();
  });

  it('has no empty or repeated entries', () => {
    for (const topic of Object.keys(VISIBILITY) as VisibilityTopic[]) {
      const values = VISIBILITY[topic].map((r) => r.value as string);
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('marks sealed and open with the same icons', () => {
    render(
      <>
        <SealBadge state="sealed">sealed</SealBadge>
        <SealBadge state="open">revealed</SealBadge>
      </>,
    );
    expect(screen.getByText(/🔒 sealed/)).toBeInTheDocument();
    expect(screen.getByText(/✅ revealed/)).toBeInTheDocument();
  });
});
