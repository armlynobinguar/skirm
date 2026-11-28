import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Stick } from '@/features/arena/chase3d/visor';
import { LookStick } from './LookStick';

/** jsdom has no PointerEvent with coordinates: a MouseEvent of the pointer type carries them. */
const ptr = (el: Element, type: string, clientX = 0, clientY = 0) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })));

describe('visor look stick', () => {
  it('writes the thumb’s push while held and lets go to zero', () => {
    const stick: { current: Stick | null } = { current: null };
    const { unmount } = render(<LookStick stick={stick} />);
    const pad = screen.getByTestId('v2-visor-stick');
    // jsdom lays the pad out at 0,0 with no size: any push is at the rim.
    ptr(pad, 'pointerdown', 40, 0);
    expect(stick.current!.x).toBeCloseTo(1);
    expect(pad).toHaveAttribute('data-held');
    ptr(pad, 'pointermove', 0, -40);
    expect(stick.current!.y).toBeCloseTo(1);
    ptr(pad, 'pointerup');
    expect(stick.current).toBeNull();
    expect(pad).not.toHaveAttribute('data-held');
    // A move without a hold does nothing.
    ptr(pad, 'pointermove', 40, 0);
    expect(stick.current).toBeNull();
    ptr(pad, 'pointerdown', 40, 0);
    unmount();
    expect(stick.current).toBeNull();
  });
});
