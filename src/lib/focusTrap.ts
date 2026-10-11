import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled):not([type="hidden"]), ' +
  'select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab navigation inside a modal while it is active.
 *
 * Yields whenever focus sits outside the modal, so stacked modals compose:
 * the modal holding focus owns Tab. Uses no layout-dependent checks, so the
 * behavior is identical in real browsers and jsdom tests.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && !el.contains(ae)) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (ae === first || !ae || ae === document.body) {
          e.preventDefault();
          last.focus();
        }
      } else if (ae === last || !ae || ae === document.body) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, ref]);
}
