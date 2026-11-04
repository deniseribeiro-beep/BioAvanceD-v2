import { LogOut, Menu, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-white/95 px-4 backdrop-blur">
      <button
        type="button"
        onClick={onMenu}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground xl:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">Live demo — padrão ouro visual</p>
        <p className="truncate text-xs text-muted-foreground">Dados mock · sem backend</p>
      </div>
      <Link
        to="/next/intake"
        className="hidden items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover sm:inline-flex"
      >
        <Plus className="h-4 w-4" />
        Novo Cadastro
      </Link>
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
        aria-label="Sair"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
