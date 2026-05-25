import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="-m-1.5 flex items-center gap-2 rounded-md p-1.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand-red)] text-white text-[12px] font-bold">DG</span>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">DGEspa</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <FiArrowLeft className="size-3.5" />
            Πίσω στην αρχική
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
