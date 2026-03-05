const LOGOUT_EVENT = 'auth:logout';

function clearStorage() {
  localStorage.removeItem('token');
  localStorage.removeItem('tempUsername');
  localStorage.removeItem('tempPassword');

  sessionStorage.removeItem('verifyAttempts');
  sessionStorage.removeItem('lastLoginTime');
}

function notifyLogout() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOGOUT_EVENT));
  }
}

export function clearClientSession(options?: { redirectToLogin?: boolean }) {
  clearStorage();
  notifyLogout();

  if (options?.redirectToLogin && window.location.pathname !== '/login') {
    window.location.replace('/login');
  }
}

export function onClientLogout(listener: () => void) {
  const wrappedListener = () => listener();
  window.addEventListener(LOGOUT_EVENT, wrappedListener);
  return () => {
    window.removeEventListener(LOGOUT_EVENT, wrappedListener);
  };
}
