import type { ReactNode } from 'react';

// The reader is dark, edge to edge, and has its own bars instead of the site header and footer.
export default function ReaderLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{'body{background:#1b1917}'}</style>
      {children}
    </>
  );
}
