import { useState, useEffect } from 'react';
import { User } from '../types/models';
import { userService } from '../services/api';

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await userService.getAll();
      
      // Garante que users seja sempre um array
      let usersData: User[] = [];
      
      if (Array.isArray(response.data)) {
        // Se response.data é um array direto
        usersData = response.data;
      } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
        // Se response.data tem uma propriedade data que é um array
        usersData = response.data.data;
      } else if (response.data && typeof response.data === 'object') {
        // Se for um objeto único, converte em array
        usersData = [response.data];
      }
      
      // Mapeia _id para id se necessário
      usersData = usersData.map((user: any) => {
        if (user._id && !user.id) {
          // Se tem _id mas não tem id, usa _id como id
          return { ...user, id: user._id };
        }
        return user;
      });
      
      setUsers(usersData);
    } catch (err: any) {
      console.error('Erro ao carregar usuários:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao carregar usuários';
      setError(errorMessage);
      setUsers([]); // Garante que a lista seja limpa em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const registerUser = async (data: Partial<User>) => {
    try {
      const response = await userService.register(data);
      setUsers([...users, response.data]);
      return response.data;
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

