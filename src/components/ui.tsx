import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

/** Small pastel UI kit matching the room page (blush/plum/lavender, rounded, soft rings). */

type Variant = 'primary' | 'soft' | 'ghost';

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-blush-400 text-white shadow hover:bg-blush-500 disabled:bg-blush-200',
    soft: 'bg-white text-plum-700 ring-1 ring-blush-200 hover:bg-blush-50 disabled:text-plum-500/50',
    ghost: 'text-plum-500 hover:bg-blush-100 disabled:text-plum-500/50',
  };
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-full px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  ok,
  aside,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; ok?: string | null; aside?: ReactNode }) {
  const id = input.id ?? input.name;
  // The label names the input; hint/error/ok text describes it (read after the name).
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-plum-700">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          {...input}
          aria-invalid={!!error}
          aria-describedby={`${id}-note`}
          className={`min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-base text-plum-900 outline-none ring-1 transition-shadow placeholder:text-plum-500/50 focus:ring-2 ${
            error ? 'ring-blush-500 focus:ring-blush-500' : 'ring-blush-200 focus:ring-lavender-500'
          }`}
        />
        {aside}
      </div>
      <p id={`${id}-note`} aria-live="polite" className={`mt-1 min-h-4 text-xs ${error ? 'text-blush-500' : ok ? 'text-emerald-600' : 'text-plum-500'}`}>
        {error ?? ok ?? hint ?? ''}
      </p>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[28px] bg-white/90 p-6 shadow-[0_8px_30px_-12px_rgba(122,74,104,0.35)] ring-4 ring-white backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-plum-900/30 p-3 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[28px] bg-cream p-5 shadow-xl ring-4 ring-white"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg text-plum-700">{title}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full px-2 text-xl text-plum-500 hover:bg-blush-100">
            ×
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        {msg && <p className="rounded-full bg-plum-700/90 px-4 py-2 text-sm text-white shadow-lg">{msg}</p>}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
