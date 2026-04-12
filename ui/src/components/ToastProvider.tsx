'use client';

/**
 * T2-02: Global toast notification system.
 * Provides useToast() hook for showing success/error/info messages.
 * Toasts auto-dismiss after 4 seconds and stack in the top-right corner.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
});

const TOAST_DURATION_MS = 4000;

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: 'rgba(39,166,68,0.12)', border: 'rgba(39,166,68,0.3)', text: '#27a644', icon: '✓' },
  error:   { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', text: '#ef4444', icon: '✕' },
  warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', icon: '⚠' },
  info:    { bg: 'rgba(113,112,255,0.12)', border: 'rgba(113,112,255,0.3)', text: '#7170ff', icon: 'ℹ' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(prev => {
      // Cap at 5 toasts; remove oldest if needed
      const capped = prev.length >= 5 ? prev.slice(1) : prev;
      return [...capped, { id, type, message }];
    });
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    timers.current.set(id, timer);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      {/* Toast stack — top-right corner, above everything */}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '380px',
          width: '100%',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(toast => {
          const style = TYPE_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: style.bg,
                border: `1px solid ${style.border}`,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                pointerEvents: 'auto',
                animation: 'toast-in 0.2s ease',
              }}
            >
              <span style={{ fontSize: '14px', color: style.text, flexShrink: 0, marginTop: '1px' }}>
                {style.icon}
              </span>
              <span style={{ fontSize: '13px', color: '#d0d6e0', flex: 1, lineHeight: '1.4' }}>
                {toast.message}
              </span>
              <button
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: '14px',
                  color: '#62666d',
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
