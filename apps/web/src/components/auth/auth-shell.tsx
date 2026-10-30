import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

/** Page frame for the sign-up, log-in and password pages. */
export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col px-4 pb-16">
      <header className="pt-[18px]">
        <Logo />
      </header>
      <main className="mt-4 rounded-panel border-2 border-ink bg-white p-6 shadow-pop">
        <h1 className="m-0 font-display text-4xl font-semibold leading-none">{title}</h1>
        {lead && <p className="mt-2 mb-0 text-sm text-muted">{lead}</p>}
        <div className="mt-5 flex flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}
