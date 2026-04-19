const DASHBOARD_DATA_CHANGED_EVENT = 'dashboard:data-changed';

export function notifyDashboardDataChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(DASHBOARD_DATA_CHANGED_EVENT));
}

export function onDashboardDataChanged(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const wrappedListener = () => listener();
  window.addEventListener(DASHBOARD_DATA_CHANGED_EVENT, wrappedListener);

  return () => {
    window.removeEventListener(DASHBOARD_DATA_CHANGED_EVENT, wrappedListener);
  };
}