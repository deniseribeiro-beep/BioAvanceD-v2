import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import Toast, { ToastType } from './Toast';
import { API_TOAST_EVENT, ApiToastEventDetail } from '../../api/client';
import './ToastContainer.css';

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
      <div className="toast-container">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

