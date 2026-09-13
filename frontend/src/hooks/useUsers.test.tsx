import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useUsers } from './useUsers';
import { userService } from '../services/api';

// #898: user.routes.js's POST /users/register returns
// { success, message, data: user } (user.routes.js:105-108). useUsers used
// to write the raw axios envelope into `users` state instead of the entity.
vi.mock('../services/api', () => ({
  userService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    register: vi.fn(),
    validateStatus: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const baseUser = {
  id: 1,
  name: 'Existing User',
  email: 'existing@example.com',
  username: 'existing',
};

function UsersHarness() {
  const { users, registerUser } = useUsers();
  const [result, setResult] = useState<unknown>(null);

  return (
    <div>
      <div data-testid="users">{JSON.stringify(users)}</div>
      <div data-testid="result">{JSON.stringify(result)}</div>
      <button
        onClick={async () => {
          const r = await registerUser({ name: 'New User', email: 'new@example.com', username: 'newuser' } as any);
          setResult(r);
        }}
      >
        register
      </button>
    </div>
  );
}

describe('useUsers mutations (#898)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registerUser pushes the unwrapped entity, not the {success,message,data} envelope', async () => {
    vi.mocked(userService.getAll).mockResolvedValue({ data: { success: true, data: [baseUser] }, status: 200 } as any);
    vi.mocked(userService.register).mockResolvedValue({
      data: {
        success: true,
        message: 'Usuário registrado com sucesso',
        data: { id: 2, name: 'New User', email: 'new@example.com', username: 'newuser' },
      },
      status: 201,
    } as any);

    render(<UsersHarness />);
    await waitFor(() => expect(screen.getByTestId('users')).toHaveTextContent('Existing User'));

    const user = userEvent.setup();
    await user.click(screen.getByText('register'));

    await waitFor(() => {
      const users = JSON.parse(screen.getByTestId('users').textContent || '[]');
      expect(users).toHaveLength(2);
      expect(users[1]).toMatchObject({ id: 2, name: 'New User' });
      expect(users[1].success).toBeUndefined();
      expect(users[1].message).toBeUndefined();
    });
  });
});
