// Implementação dos métodos da classe Log conforme diagrama UML

import { Log } from '../types/models';

/**
 * Consulta logs com filtros
 * Implementa: Log.queryLogs(filter): List<AuditLog>
 * Retorna array de Log (AuditLog não existe no diagrama, retornamos Log[])
 */
export function queryLogs(
  allLogs: Log[],
  filters?: {
    userID?: string;
    userName?: string;
    action?: string;
    entity?: string;
    result?: string;
    severity?: string;
    origin?: string;
    startDate?: Date;
    endDate?: Date;
    searchTerm?: string;
  }
): Log[] {
  let filtered = [...allLogs];

  if (filters) {
    if (filters.userID) {
      filtered = filtered.filter((log) => log.userID === filters.userID);
    }
    if (filters.userName) {
      filtered = filtered.filter((log) =>
        String(log.userName || '').toLowerCase().includes(filters.userName!.toLowerCase())
      );
    }
    if (filters.action) {
      filtered = filtered.filter((log) => log.action === filters.action);
    }
    if (filters.entity) {
      filtered = filtered.filter((log) => log.entity === filters.entity);
    }
    if (filters.result) {
      filtered = filtered.filter((log) => log.result === filters.result);
    }
    if (filters.severity) {
      filtered = filtered.filter((log) => log.severity === filters.severity);
    }
    if (filters.origin) {
      filtered = filtered.filter((log) => log.origin === filters.origin);
    }
    if (filters.startDate) {
      filtered = filtered.filter(
        (log) => Boolean(log.timestamp) && new Date(log.timestamp!).getTime() >= filters.startDate!.getTime()
      );
    }
    if (filters.endDate) {
      filtered = filtered.filter(
        (log) => Boolean(log.timestamp) && new Date(log.timestamp!).getTime() <= filters.endDate!.getTime()
      );
    }
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          String(log.message || '').toLowerCase().includes(term) ||
          String(log.userName || '').toLowerCase().includes(term) ||
          String(log.entity || '').toLowerCase().includes(term)
      );
    }
  }

  return filtered;
}


