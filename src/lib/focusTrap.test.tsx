import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from './focusTrap';

function Harness({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <div>
      <button>outside</button>
      <div ref={ref}>
        <button>one</button>
        <button>two</button>
        <button disabled>off</button>
      </div>
    </div>
  );
}

const tab = (shift = false) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });

describe('useFocusTrap', () => {
  it('wraps Tab forward from the last focusable to the first', () => {
    render(<Harness />);
    screen.getByText('two').focus();
    tab();
    expect(document.activeElement?.textContent).toBe('one');
  });

  it('wraps Shift+Tab backward, skipping disabled controls', () => {
    render(<Harness />);
    screen.getByText('one').focus();
    tab(true);
    // 'off' is disabled: the cycle is one <-> two.
    expect(document.activeElement?.textContent).toBe('two');
  });

  it('yields when focus is outside the modal (stacked modals compose)', () => {
    render(<Harness />);
    screen.getByText('outside').focus();
    tab();
    expect(document.activeElement?.textContent).toBe('outside');
  });

  it('does nothing while inactive', () => {
    render(<Harness active={false} />);
    screen.getByText('two').focus();
    tab();
    expect(document.activeElement?.textContent).toBe('two');
  });
});
