import { useEffect, useRef } from 'react';
import { authService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

/**
 * Hook para detectar atividade do usuário e renovar sessão
 * Envia keepalive a cada atividade detectada (com throttling)
 */
export function useActivityDetector(isAuthenticated: boolean) {
  const lastKeepAliveRef = useRef<number>(0);
  const keepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const KEEPALIVE_THROTTLE = 30000; // 30 segundos - mínimo entre keepalives
  const KEEPALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos - keepalive periódico mesmo sem atividade

  const sendKeepAlive = async () => {
    const now = Date.now();
    
    // Throttle: só envia se passou o tempo mínimo
    if (now - lastKeepAliveRef.current < KEEPALIVE_THROTTLE) {
      return;
    }

    try {
      await authService.keepAlive();
      lastKeepAliveRef.current = now;
    } catch (error: any) {
      // Se sessão expirou, não faz nada (o middleware vai redirecionar)
      if (error.response?.data?.sessionExpired) {
        console.log('Sessão expirada por inatividade');
        clearClientSession({ redirectToLogin: true });
      }
      // Outros erros são ignorados silenciosamente
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    // Eventos de atividade do usuário
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const handleActivity = () => {
      sendKeepAlive();
    };

    // Adiciona listeners para eventos de atividade
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Keepalive periódico (mesmo sem atividade detectada)
    keepAliveIntervalRef.current = setInterval(() => {
      sendKeepAlive();
    }, KEEPALIVE_INTERVAL);

    // Primeiro keepalive ao montar
    sendKeepAlive();

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (keepAliveIntervalRef.current) {
        clearInterval(keepAliveIntervalRef.current);
      }
    };
  }, [isAuthenticated]);
}

