import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOVER_DELAY = 350;
const GAP = 8;
const VIEWPORT_INSET = 8;

type Position = { top: number; left: number };

/**
 * Names an icon-only control for pointer and keyboard users.
 *
 * The tooltip repeats the control's own `aria-label`; it is deliberately not
 * wired with `aria-describedby`, which would read the same name twice. It is
 * portalled so an ancestor's `overflow: hidden` cannot clip it.
 */
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const anchor = useRef<HTMLSpanElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const hide = () => {
    clearHoverTimer();
    setOpen(false);
  };

  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const enter = () => {
      clearHoverTimer();
      hoverTimer.current = setTimeout(() => setOpen(true), HOVER_DELAY);
    };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      clearHoverTimer();
      setOpen(false);
    };
    const focusIn = () => {
      clearHoverTimer();
      setOpen(true);
    };
    const focusOut = () => {
      clearHoverTimer();
      setOpen(false);
    };
    // Capture so the non-bubbling mouseenter/mouseleave/focus/blur dispatched
    // on the control is still observed by its wrapper.
    node.addEventListener('mouseenter', enter, true);
    node.addEventListener('mouseleave', leave, true);
    node.addEventListener('focus', focusIn, true);
    node.addEventListener('blur', focusOut, true);
    return () => {
      node.removeEventListener('mouseenter', enter, true);
      node.removeEventListener('mouseleave', leave, true);
      node.removeEventListener('focus', focusIn, true);
      node.removeEventListener('blur', focusOut, true);
      clearHoverTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const control = anchor.current;
    const tooltip = tip.current;
    if (!control || !tooltip) return;
    const controlRect = control.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = controlRect.top - tooltipRect.height - GAP;
    if (top < VIEWPORT_INSET) top = controlRect.bottom + GAP;

    let left = controlRect.left + controlRect.width / 2 - tooltipRect.width / 2;
    // End-align to the control before clamping, so a control at the viewport's
    // end edge keeps the tooltip inside without detaching it from the control.
    if (left + tooltipRect.width > viewportWidth - VIEWPORT_INSET) left = controlRect.right - tooltipRect.width;
    if (left < VIEWPORT_INSET) left = controlRect.left;
    if (left + tooltipRect.width > viewportWidth - VIEWPORT_INSET) left = viewportWidth - tooltipRect.width - VIEWPORT_INSET;
    if (left < VIEWPORT_INSET) left = VIEWPORT_INSET;
    if (top + tooltipRect.height > viewportHeight - VIEWPORT_INSET) top = Math.max(VIEWPORT_INSET, viewportHeight - tooltipRect.height - VIEWPORT_INSET);

    setPosition({ top, left });
  }, [open, label]);

  return (
    <>
      <span
        ref={anchor}
        className="tooltip-anchor"
        onMouseOver={event => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          clearHoverTimer();
          hoverTimer.current = setTimeout(() => setOpen(true), HOVER_DELAY);
        }}
        onMouseOut={event => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          hide();
        }}
        onKeyDown={event => { if (event.key === 'Escape') hide(); }}
        onPointerDown={hide}
        onMouseDown={hide}
        onClick={hide}
      >
        {children}
      </span>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={tip} role="tooltip" className="tooltip" style={{ top: position.top, left: position.left }}>
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
