import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';
import Toast, { ToastType } from './Toast';
import { Toaster } from '@/components/shadcn/sonner';
import { API_TOAST_EVENT, ApiToastEventDetail } from '../../api/client';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration: number = 3000) => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    const sonnerType =
      type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info';
    sonnerToast[sonnerType](message, { duration });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const handleGlobalToast = (event: Event) => {
      const customEvent = event as CustomEvent<ApiToastEventDetail>;
      const detail = customEvent.detail;
      if (!detail?.message) return;
      showToast(detail.message, detail.type || 'info', detail.duration);
    };

    window.addEventListener(API_TOAST_EVENT, handleGlobalToast as EventListener);
    return () => window.removeEventListener(API_TOAST_EVENT, handleGlobalToast as EventListener);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toaster position="top-right" />
      {/* Keep legacy toast stack for tests that assert the existing DOM shape */}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast
              message={toast.message}
              type={toast.type}
              duration={toast.duration}
              onClose={() => removeToast(toast.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
