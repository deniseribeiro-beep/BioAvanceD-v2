import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import LegalAcceptanceGate from '../LegalAcceptanceGate';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col xl:pl-72">
        <Header />
        <main className="relative z-0 min-w-0 flex-1 overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
          <LegalAcceptanceGate>{children}</LegalAcceptanceGate>
        </main>
      </div>
    </div>
  );
}
