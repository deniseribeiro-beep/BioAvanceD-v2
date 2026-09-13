import { useState, useEffect } from 'react';
import { User } from '../types/models';
import { userService } from '../services/api';
import { extractResponseEntity, extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadUsers is called again before
  // a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setUsers([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadUsers = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      setError(null);
      const response = await userService.getAll();
      if (!requestSeq.isCurrent(seq)) return;

      // Mapeia _id para id se necessário
      const usersData = extractResponseItems<User>(response).map((user: any) => {
        if (user._id && !user.id) {
          // Se tem _id mas não tem id, usa _id como id
          return { ...user, id: user._id };
        }
        return user;
      });

      setUsers(usersData);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      console.error('Erro ao carregar usuários:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao carregar usuários';
      setError(errorMessage);
      setUsers([]); // Garante que a lista seja limpa em caso de erro
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const registerUser = async (data: Partial<User>) => {
    try {
      const response = await userService.register(data);
      const newUser = extractResponseEntity<User>(response, data as any);
      setUsers([...users, newUser]);
      return newUser;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao registrar usuário');
    }
  };

  const validateUserStatus = async (id: number) => {
    try {
      const response = await userService.validateStatus(id);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao validar status');
    }
  };

  const updateUser = async (id: number | string, data: Partial<User>) => {
    try {
      const response = await userService.update(id, data);
      // Recarrega a lista completa para garantir sincronização
      await loadUsers();
      return response.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao atualizar usuário';
      throw new Error(errorMessage);
    }
  };

  const deleteUser = async (id: number | string) => {
    try {
      await userService.delete(id);
      // Recarrega a lista completa para garantir sincronização
      await loadUsers();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Erro ao deletar usuário';
      throw new Error(errorMessage);
    }
  };

  return {
    users,
    loading,
    error,
    loadUsers,
    registerUser,
    validateUserStatus,
    updateUser,
    deleteUser,
  };
}

