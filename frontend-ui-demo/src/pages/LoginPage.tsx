import { Link } from 'react-router-dom';
import logo from '../LOGO_BIOAVANCED_CORE.png';

export function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-soft via-background to-cyan-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-8 shadow-sm" data-testid="login-form">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={logo} alt="BioAvanceD" className="mb-3 h-14 w-14 object-contain" />
          <h1 className="text-xl font-semibold text-primary">BioAvanceD</h1>
          <p className="mt-1 text-sm text-muted-foreground">Acesso institucional · demo visual</p>
        </div>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="user">Usuário</label>
            <input id="user" className="w-full rounded-md border border-border px-3 py-2 text-sm" defaultValue="admin" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="pass">Senha</label>
            <input id="pass" type="password" className="w-full rounded-md border border-border px-3 py-2 text-sm" defaultValue="••••••••" />
          </div>
          <Link
            to="/dashboard"
            className="flex w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Entrar na demo
          </Link>
        </form>
      </div>
    </div>
  );
}
