/* eslint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CircleCheck, X } from 'lucide-react';

export type ToastInput = { message: string; detail?: string };
type ToastItem = ToastInput & { id: number };

const TOAST_DURATION = 5000;
const MAX_TOASTS = 3;

const ToastContext = createContext<{ enqueue: (toast: ToastInput) => void }>({ enqueue: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

/**
 * One polite status region, always mounted in the app shell.
 *
 * Toasts are confirmations for actions that succeeded with no other visible
 * sign. Errors never come here: they stay in the inline alerts beside the
 * control that produced them.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const enqueue = useCallback((toast: ToastInput) => {
    const item = { ...toast, id: nextId.current++ };
    setToasts(current => [...current, item].slice(-MAX_TOASTS));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ enqueue }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map(toast => <Toast key={toast.id} toast={toast} dismiss={() => dismiss(toast.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, dismiss }: { toast: ToastItem; dismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(TOAST_DURATION);
  const startedAt = useRef(0);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const enter = () => setPaused(true);
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      setPaused(false);
    };
    const focusIn = () => setPaused(true);
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      setPaused(false);
    };
    // Capture so entering or leaving any child (the message text, the Dismiss
    // button) pauses and resumes the same timer, including the non-bubbling
    // focus and blur events.
    node.addEventListener('mouseenter', enter, true);
    node.addEventListener('mouseleave', leave, true);
    node.addEventListener('focus', focusIn, true);
    node.addEventListener('blur', focusOut, true);
    return () => {
      node.removeEventListener('mouseenter', enter, true);
      node.removeEventListener('mouseleave', leave, true);
      node.removeEventListener('focus', focusIn, true);
      node.removeEventListener('blur', focusOut, true);
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(dismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, dismiss]);

  return (
    <div ref={root} className="toast">
      <CircleCheck className="toast-icon" size={18} aria-hidden="true" />
      <div className="toast-content">
        <p className="toast-message">{toast.message}</p>
        {toast.detail && <p className="toast-detail">{toast.detail}</p>}
      </div>
      <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={dismiss}>
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
